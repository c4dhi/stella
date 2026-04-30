"""Stage 2: Expert Pool — parallel expert execution with structured verdicts.

Takes the list of expert names from the Input Gate, runs them all in parallel
via asyncio.gather(), and returns structured ExpertVerdict objects.

All experts (including task_extraction) run as foreground — their results
are needed before response generation to ensure accurate state context.

Target latency: ~300-500ms wall-clock (parallelized).

Timeout per expert: configurable via EXPERT_TIMEOUT_MS env var (default: 15000ms).
On timeout: returns a failure verdict for that expert.
"""

import asyncio
import os
import time
from typing import Dict, Any, List, Optional

from stella_agent_sdk.tools import ToolRegistry

from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.experts.runner import ExpertRunner
from stella_v2_agent.models.expert_verdict import ExpertVerdict
from stella_v2_agent.llm.service import LLMService
import logging

logger = logging.getLogger(__name__)


class ExpertPool:
    """Runs selected experts in parallel and collects their verdicts.

    All experts run as foreground and block until complete. This ensures
    task_extraction results (deliverable collection, state transitions)
    are available before response generation, preventing stale context.

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
        self._timeout_ms = int(os.environ.get("EXPERT_TIMEOUT_MS", "15000"))

        # Configurable sets (overridable via apply_config)
        self._always_run: set = set(self._registry.get_always_triggered_names())

    def set_tool_registry(self, tool_registry: ToolRegistry) -> None:
        """Set or update the tool registry (called after session start)."""
        self._tool_registry = tool_registry

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "always_run" in config:
            self._always_run = set(config["always_run"])

    async def run(
        self,
        expert_names: List[str],
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
    ) -> List[ExpertVerdict]:
        """Run all experts in parallel and return their verdicts.

        All experts block until complete — results are needed for
        arbitration and accurate state context before response generation.
        """
        # Ensure always-run experts are included
        names_set = set(expert_names)
        for name in self._always_run:
            if name not in names_set and self._registry.get(name):
                expert_names = list(expert_names) + [name]

        if not expert_names:
            return []

        timeout_seconds = self._timeout_ms / 1000.0

        start_time = time.time()
        verdicts = await self._run_experts(
            expert_names, user_input, conversation_history, sm_context, timeout_seconds
        )

        total_ms = (time.time() - start_time) * 1000
        logger.info(f"Expert Pool: {len(verdicts)} experts in {total_ms:.0f}ms")

        return verdicts

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
