"""Stage 2: Expert Pool — parallel expert execution with structured verdicts.

Takes the list of expert names from the Input Gate, runs them all in parallel
via asyncio.gather(), and returns structured ExpertVerdict objects.

Target latency: ~150-300ms wall-clock (parallelized).

Background experts (e.g. task_extraction) run concurrently but do NOT block
the response pipeline. Their results are collected via await after
response streaming has already started.

Timeout per expert: configurable via EXPERT_TIMEOUT_MS env var (default: 5000ms).
On timeout: returns a failure verdict for that expert.
"""

import asyncio
import os
import time
from typing import Dict, Any, List, Tuple, Optional

from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.experts.runner import ExpertRunner
from stella_v2_agent.models.expert_verdict import ExpertVerdict
from stella_v2_agent.llm.service import LLMService


class ExpertPool:
    """Runs selected experts in parallel and collects their verdicts.

    Splits experts into two tracks:
    - Foreground: needed for arbitration/response (blocks pipeline)
    - Background: only needed post-response (runs concurrently, collected later)
    """

    def __init__(self, llm_service: LLMService, expert_registry: ExpertRegistry):
        self._runner = ExpertRunner(llm_service)
        self._registry = expert_registry
        self._timeout_ms = int(os.environ.get("EXPERT_TIMEOUT_MS", "5000"))

        # Configurable sets (overridable via apply_config)
        self._always_run: set = {"task_extraction"}
        self._background_experts: set = {"task_extraction"}

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "always_run" in config:
            self._always_run = set(config["always_run"])
        if "background_experts" in config:
            self._background_experts = set(config["background_experts"])

    async def run_foreground(
        self,
        expert_names: List[str],
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
    ) -> Tuple[List[ExpertVerdict], Optional[asyncio.Task]]:
        """Run experts, returning foreground verdicts immediately and a background task.

        Foreground experts block until complete (needed for arbitration).
        Background experts (task_extraction) are launched concurrently
        but returned as an asyncio.Task to be awaited later.

        Returns:
            Tuple of (foreground_verdicts, background_task_or_None).
            Await the background task after response streaming to get
            background verdicts.
        """
        # Ensure always-run experts are included
        names_set = set(expert_names)
        for name in self._always_run:
            if name not in names_set and self._registry.get(name):
                expert_names = list(expert_names) + [name]

        if not expert_names:
            return [], None

        timeout_seconds = self._timeout_ms / 1000.0

        # Split into foreground and background
        fg_names = [n for n in expert_names if n not in self._background_experts]
        bg_names = [n for n in expert_names if n in self._background_experts]

        # Launch background experts immediately (don't await yet)
        bg_task: Optional[asyncio.Task] = None
        if bg_names:
            bg_task = asyncio.create_task(
                self._run_experts(bg_names, user_input, conversation_history, sm_context, timeout_seconds)
            )

        # Run foreground experts and wait for them
        start_time = time.time()
        fg_verdicts = await self._run_experts(
            fg_names, user_input, conversation_history, sm_context, timeout_seconds
        )

        total_ms = (time.time() - start_time) * 1000
        print(
            f"[ExpertPool] Foreground: {len(fg_verdicts)} experts in {total_ms:.0f}ms "
            f"| Background: {len(bg_names)} launched"
        )

        return fg_verdicts, bg_task

    async def collect_background(
        self, bg_task: Optional[asyncio.Task]
    ) -> List[ExpertVerdict]:
        """Await background expert results. Call after response streaming."""
        if bg_task is None:
            return []
        try:
            return await bg_task
        except Exception as e:
            print(f"[ExpertPool] Background experts failed: {e}")
            return []

    async def _run_experts(
        self,
        expert_names: List[str],
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
        timeout_seconds: float,
    ) -> List[ExpertVerdict]:
        """Run a list of experts in parallel and return their verdicts."""
        tasks = []
        for name in expert_names:
            config = self._registry.get(name)
            if not config:
                print(f"[ExpertPool] Expert '{name}' not found in registry, skipping")
                continue
            if not config.enabled:
                print(f"[ExpertPool] Expert '{name}' is disabled, skipping")
                continue
            tasks.append(self._run_with_timeout(config, user_input, conversation_history, sm_context, timeout_seconds))

        if not tasks:
            return []

        verdicts = await asyncio.gather(*tasks, return_exceptions=False)
        return list(verdicts)

    async def _run_with_timeout(
        self,
        config,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
        timeout_seconds: float,
    ) -> ExpertVerdict:
        """Run a single expert with a timeout wrapper."""
        try:
            return await asyncio.wait_for(
                self._runner.run(config, user_input, conversation_history, sm_context),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            print(f"[ExpertPool] Expert '{config.name}' timed out after {self._timeout_ms}ms")
            return ExpertVerdict(
                expert_name=config.name,
                verdict="timeout",
                confidence=0.0,
                recommendation="Expert timed out",
                priority=config.priority,
                latency_ms=float(self._timeout_ms),
                success=False,
                error_message=f"Timed out after {self._timeout_ms}ms",
            )
