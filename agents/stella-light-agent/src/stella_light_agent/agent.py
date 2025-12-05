"""
Stella Light Agent - Simplified single-LLM agent with prompt-based guardrails.

This is a lightweight version of stella-agent that:
- Uses a single LLM call instead of InputGate/ExpertPool/Aggregator pipeline
- Embeds safety guardrails directly in the system prompt
- Maintains full state machine and progress tracking compatibility
- Supports streaming responses
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype

from stella_light_agent.llm.service import LLMService
from stella_light_agent.processor import LightProcessor, ProcessorResult
from stella_light_agent.state_machine import StateMachine
from stella_light_agent.prompts import LightPromptBuilder
from stella_light_agent.adapters import ProgressAdapter


class StellaLightAgent(BaseAgent):
    """
    Stella Light Agent - Simplified single-LLM agent.

    Processing Flow:
    1. Build unified prompt with state context + guardrails
    2. Single LLM call with streaming response
    3. Parse deliverables from response
    4. Update state machine
    5. Emit progress update

    This is much simpler than the full stella-agent which uses
    InputGate → ExpertPool → Aggregator pipeline.
    """

    def __init__(self, llm_config_path: Optional[str] = None):
        """
        Initialize the Stella Light Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file
        """
        super().__init__()

        # Determine config path
        if llm_config_path is None:
            llm_config_path = self._find_config_file("config/llm_config.json")

        # Initialize components
        self.llm_service = LLMService(config_path=llm_config_path)
        self.processor = LightProcessor(llm_service=self.llm_service)
        self.state_machine = StateMachine()
        self.prompt_builder = LightPromptBuilder()

        # Session config
        self.config: Dict[str, Any] = {}
        self._session_started_at: Optional[str] = None

        print("[StellaLightAgent] Initialized")

    def _find_config_file(self, relative_path: str) -> Optional[str]:
        """Find config file in various locations."""
        locations = [
            Path(relative_path),
            Path(__file__).parent.parent.parent / relative_path,
            Path("/app") / relative_path,
        ]

        for location in locations:
            if location.exists():
                return str(location)

        return None

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize session with configuration.

        Args:
            session_id: Unique session identifier
            config: Session configuration including plan
        """
        self.config = config
        self._session_started_at = datetime.now(timezone.utc).isoformat()

        print(f"[StellaLightAgent] Session started: {session_id}")
        print(f"[StellaLightAgent] Config keys: {list(config.keys())}")

        # Initialize state machine with plan
        # First check for plan_id - load plan from disk (matches stella-agent behavior)
        plan_config = None
        if "plan_id" in config:
            plan_id = config["plan_id"]
            plan_path = self._find_plan_file(plan_id)
            if plan_path:
                with open(plan_path) as f:
                    plan_config = json.load(f)
                print(f"[StellaLightAgent] Loaded plan '{plan_id}' from disk")
            else:
                print(f"[StellaLightAgent] Plan file not found: {plan_id}")
        elif "plan" in config:
            # Also support inline plan config
            plan_config = config.get("plan")
            if isinstance(plan_config, str):
                # It's a plan ID string
                plan_path = self._find_plan_file(plan_config)
                if plan_path:
                    with open(plan_path) as f:
                        plan_config = json.load(f)
                else:
                    print(f"[StellaLightAgent] Plan file not found: {plan_config}")
                    plan_config = None

        if plan_config:
            success = self.state_machine.initialize(plan_config)
            print(f"[StellaLightAgent] State machine initialized: {success}")
        else:
            print(f"[StellaLightAgent] No plan_id or plan in config - state machine disabled")

        # Apply LLM config overrides
        llm_overrides = config.get("llm", {})
        if llm_overrides:
            if "model" in llm_overrides:
                self.llm_service.default_config.model = llm_overrides["model"]
            if "temperature" in llm_overrides:
                self.llm_service.default_config.temperature = llm_overrides["temperature"]

    def _find_plan_file(self, plan_id: str) -> Optional[str]:
        """Find plan file by ID."""
        locations = [
            Path(f"config/plans/{plan_id}.json"),
            Path(__file__).parent.parent.parent / f"config/plans/{plan_id}.json",
            Path("/app/config/plans") / f"{plan_id}.json",
        ]

        for location in locations:
            if location.exists():
                return str(location)

        return None

    async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
        """
        Called when agent is ready to start.
        Send initial progress state to frontend.
        """
        if self.state_machine.is_initialized and self.state_machine.execution_state:
            progress_state = ProgressAdapter.from_execution_state(
                self.state_machine.execution_state,
                started_at=self._session_started_at
            )
            yield AgentOutput.progress_update(
                session_id,
                progress_state,
                update_trigger="session_start",
                agent_name="stella-light-agent",
                agent_icon="💡"
            )

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """
        Process user input through single LLM call with streaming.

        Args:
            input: AgentInput containing user text and metadata

        Yields:
            AgentOutput messages (status, text chunks, deliverables, progress)
        """
        self._is_processing = True

        try:
            # Fetch conversation history
            conversation_history = await self._fetch_conversation_history(limit=20)

            # Get state machine context
            sm_context = {}
            if self.state_machine.is_initialized:
                sm_context = self.state_machine.get_context_for_prompt()

            # Show processing status
            yield AgentOutput.status(
                input.session_id,
                "Processing your message...",
                StatusSubtype.PROCESSING
            )

            print(f"[StellaLightAgent] Processing: '{input.text}'")

            # Build prompts
            system_prompt = self.prompt_builder.build_system_prompt(sm_context)
            user_message = self.prompt_builder.build_user_message(
                user_input=input.text,
                conversation_history=conversation_history,
                context=sm_context
            )

            # Process through LightProcessor (streams response)
            result: Optional[ProcessorResult] = None
            async for output in self.processor.process(
                session_id=input.session_id,
                system_prompt=system_prompt,
                user_message=user_message
            ):
                # Check if this is the ProcessorResult
                if isinstance(output, ProcessorResult):
                    result = output
                else:
                    yield output

            # Handle deliverables
            if result and result.deliverables:
                print(f"[StellaLightAgent] Extracted deliverables: {list(result.deliverables.keys())}")

                if self.state_machine.is_initialized:
                    sm_result = self.state_machine.process_deliverables(result.deliverables)

                    # Handle state transitions
                    if sm_result.should_advance and sm_result.next_state_id:
                        self.state_machine.advance_state()

                # Emit deliverables
                for key, data in result.deliverables.items():
                    if isinstance(data, dict):
                        value = data.get("value")
                    else:
                        value = data
                    yield AgentOutput.deliverable(input.session_id, key=key, value=value)
            else:
                # No deliverables extracted - increment turn counter
                if self.state_machine.is_initialized:
                    self.state_machine.increment_turn()

            # Emit progress update
            if self.state_machine.is_initialized and self.state_machine.execution_state:
                self.state_machine.clear_state_changed_flag()
                progress_state = ProgressAdapter.from_execution_state(
                    self.state_machine.execution_state,
                    started_at=self._session_started_at
                )
                yield AgentOutput.progress_update(
                    input.session_id,
                    progress_state,
                    update_trigger="turn_completion",
                    agent_name="stella-light-agent",
                    agent_icon="💡"
                )

        except Exception as e:
            print(f"[StellaLightAgent] Error: {e}")
            import traceback
            traceback.print_exc()
            yield AgentOutput.error(
                input.session_id,
                str(e),
                error_type="processing_error",
                recoverable=True
            )
        finally:
            self._is_processing = False

    async def on_interrupt(self, session_id: str) -> None:
        """Handle user interruption (barge-in)."""
        print(f"[StellaLightAgent] Interrupt received: {session_id}")
        self.processor.cancel()
        self._is_processing = False

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """Handle runtime configuration updates."""
        print(f"[StellaLightAgent] Config update: {list(config.keys())}")

        # Merge with existing config
        self.config.update(config)

        # Apply LLM overrides
        llm_overrides = config.get("llm", {})
        if llm_overrides:
            if "model" in llm_overrides:
                self.llm_service.default_config.model = llm_overrides["model"]
            if "temperature" in llm_overrides:
                self.llm_service.default_config.temperature = llm_overrides["temperature"]

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """
        Clean up session and return summary.

        Returns:
            Summary with collected deliverables and statistics
        """
        print(f"[StellaLightAgent] Session ending: {session_id}")

        summary = {
            "agent": "stella-light-agent",
            "llm_stats": self.llm_service.get_usage_stats(),
        }

        if self.state_machine.is_initialized and self.state_machine.execution_state:
            summary["deliverables"] = self.state_machine.execution_state.get_all_deliverable_values()
            summary["progress"] = self.state_machine.execution_state.calculate_progress()
            summary["state_machine"] = self.state_machine.get_status_summary()

        # Reset for next session
        self.state_machine = StateMachine()
        self.llm_service.reset_stats()
        self._session_started_at = None

        return summary

    async def _fetch_conversation_history(self, limit: int = 20) -> List[Dict[str, str]]:
        """Fetch conversation history from the SDK."""
        try:
            history = await self.get_chat_history()
            if history:
                # Convert to simple format
                return [
                    {"role": msg.get("role", "user"), "content": msg.get("content", "")}
                    for msg in history[-limit:]
                ]
        except Exception as e:
            print(f"[StellaLightAgent] Failed to fetch history: {e}")

        return []
