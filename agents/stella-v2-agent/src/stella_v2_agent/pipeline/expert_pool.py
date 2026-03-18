"""Stage 2: Expert Pool — parallel expert execution with structured verdicts.

Takes the list of expert names from the Input Gate, runs them all in parallel
via asyncio.gather(), and returns structured ExpertVerdict objects.

Target latency: ~150-300ms wall-clock (parallelized).

Background experts (e.g. task_extraction) run concurrently but do NOT block
the response pipeline. Their results are collected via await after
response streaming has already started.

Timeout per expert: configurable via EXPERT_TIMEOUT_MS env var (default: 5000ms).
Background expert timeout: BACKGROUND_EXPERT_TIMEOUT_MS env var (default: 15000ms).
On timeout: returns a failure verdict for that expert.
"""

import asyncio
import os
import time
from typing import Dict, Any, List, Tuple, Optional

from stella_agent_sdk.tools import ToolRegistry

from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.experts.runner import ExpertRunner
from stella_v2_agent.models.expert_verdict import ExpertVerdict
from stella_v2_agent.llm.service import LLMService
import logging

logger = logging.getLogger(__name__)


class ExpertPool:
    """Runs selected experts in parallel and collects their verdicts.

    Splits experts into two tracks:
    - Foreground: needed for arbitration/response (blocks pipeline)
    - Background: only needed post-response (runs concurrently, collected later)

    Experts with can_call_functions=True receive tools from the tool_registry
    and execute in tool-calling mode instead of JSON mode.
    """

    def __init__(
        self,
        llm_service: LLMService,
        expert_registry: ExpertRegistry,
        tool_registry: Optional[ToolRegistry] = None,
    ):
        self._runner = ExpertRunner(llm_service)
        self._registry = expert_registry
        self._tool_registry = tool_registry
        self._timeout_ms = int(os.environ.get("EXPERT_TIMEOUT_MS", "5000"))
        self._bg_timeout_ms = int(os.environ.get("BACKGROUND_EXPERT_TIMEOUT_MS", "15000"))

        # Configurable sets (overridable via apply_config)
        self._always_run: set = set(self._registry.get_always_triggered_names())
        self._background_experts: set = {"task_extraction"}

    def set_tool_registry(self, tool_registry: ToolRegistry) -> None:
        """Set or update the tool registry (called after session start)."""
        self._tool_registry = tool_registry

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

        fg_timeout_seconds = self._timeout_ms / 1000.0
        bg_timeout_seconds = self._bg_timeout_ms / 1000.0

        # Split into foreground and background
        fg_names = [n for n in expert_names if n not in self._background_experts]
        bg_names = [n for n in expert_names if n in self._background_experts]

        # Launch background experts immediately (don't await yet)
        # Background experts get a longer timeout since they don't block the response
        bg_task: Optional[asyncio.Task] = None
        if bg_names:
            bg_task = asyncio.create_task(
                self._run_experts(bg_names, user_input, conversation_history, sm_context, bg_timeout_seconds)
            )

        # Run foreground experts and wait for them
        start_time = time.time()
        fg_verdicts = await self._run_experts(
            fg_names, user_input, conversation_history, sm_context, fg_timeout_seconds
        )

        total_ms = (time.time() - start_time) * 1000
        logger.info(
            f"Foreground: {len(fg_verdicts)} experts in {total_ms:.0f}ms "
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
            logger.error(f"Background experts failed: {e}")
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
                logger.warning(f"Expert '{name}' not found in registry, skipping")
                continue
            if not config.enabled:
                logger.info(f"Expert '{name}' is disabled, skipping")
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
        # Resolve tools for this expert (if tool-calling mode)
        tools = None
        if config.can_call_functions and self._tool_registry:
            tools = self._tool_registry.list_tools()

        try:
            return await asyncio.wait_for(
                self._runner.run(config, user_input, conversation_history, sm_context, tools=tools),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            timeout_ms = timeout_seconds * 1000
            logger.warning(f"Expert '{config.name}' timed out after {timeout_ms:.0f}ms")
            return ExpertVerdict(
                expert_name=config.name,
                verdict="timeout",
                confidence=0.0,
                recommendation="Expert timed out",
                priority=config.priority,
                latency_ms=timeout_ms,
                success=False,
                error_message=f"Timed out after {timeout_ms:.0f}ms",
            )
