"""
Grace Agent - Full agent implementation using the Grace AI Agent SDK.

This agent implements the InputGate → ExpertPool → Aggregator pipeline
for intelligent conversation handling with expert consultation.

Includes State Machine integration for plan-based conversation flow
with task tracking and deliverable collection.
"""

import asyncio
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional
import uuid

from grace_agent_sdk.agent.base import BaseAgent
from grace_agent_sdk.messages.input import AgentInput
from grace_agent_sdk.messages.output import AgentOutput
from grace_agent_sdk.messages.types import StatusSubtype

from grace_agent.llm.service import LLMService
from grace_agent.pipeline.input_gate import InputGate
from grace_agent.pipeline.expert_pool import ExpertPool
from grace_agent.pipeline.aggregator import Aggregator
from grace_agent.models.gate_result import GateRoute
from grace_agent.state_machine import StateMachine
from grace_agent.prompts.builder import PromptBuilder


class GraceAgent(BaseAgent):
    """
    Grace AI Agent that implements intelligent conversation handling.

    Processing Flow:
    1. InputGate analyzes input → SAFE or UNSAFE routing
    2. If SAFE: Stream response directly
    3. If UNSAFE: Run ExpertPool → Aggregator to synthesize response

    With State Machine:
    - Tracks conversation through states with tasks/deliverables
    - STRICT mode: Sequential task processing
    - LOOSE mode: Flexible task processing
    - Timekeeper expert for stuck conversation detection

    Communicates via AgentOutput messages from the SDK.
    """

    def __init__(
        self,
        llm_config_path: Optional[str] = None,
        experts_dir: Optional[str] = None
    ):
        """
        Initialize the Grace Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file
            experts_dir: Path to directory containing expert JSON configs
        """
        super().__init__()

        # Determine paths - try multiple locations for Docker compatibility
        if llm_config_path is None:
            llm_config_path = self._find_config_file("config/llm_config.json")

        if experts_dir is None:
            experts_dir = self._find_experts_dir()

        # Initialize LLM service
        self.llm_service = LLMService(config_path=llm_config_path)

        # Initialize pipeline components
        self.input_gate = InputGate(llm_service=self.llm_service)
        self.expert_pool = ExpertPool(llm_service=self.llm_service, agents_dir=experts_dir)
        self.aggregator = Aggregator(llm_service=self.llm_service)

        # Initialize state machine and prompt builder
        self.state_machine = StateMachine()
        self.prompt_builder = PromptBuilder()

        # Timekeeper threshold (turns without deliverable before invoking)
        self.timekeeper_threshold = 2

        # Session config (no conversation state - fetched on demand)
        self.config: Dict[str, Any] = {}

        print(f"[GraceAgent] Initialized with {len(self.expert_pool.agents)} experts")

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """
        Process user input through the InputGate → ExpertPool → Aggregator pipeline.

        With State Machine integration:
        - Passes state context to InputGate for prompt building
        - Processes extracted deliverables through state machine
        - Handles state transitions
        - Emits todo list via debug messages

        Args:
            input: AgentInput containing user text and metadata

        Yields:
            AgentOutput messages (status updates, text chunks, debug, errors)
        """
        self._is_processing = True

        try:
            # Fetch conversation history from database (stateless - no in-memory storage)
            conversation_history = await self._fetch_conversation_history(limit=20)

            # Get state machine context for prompts
            sm_context = {}
            if self.state_machine.is_initialized:
                sm_context = self.state_machine.get_context_for_prompt()

            # Build context from fetched history
            context = self._build_context(conversation_history)

            # Step 1: Run InputGate
            yield AgentOutput.status(
                input.session_id,
                "Processing your message...",
                StatusSubtype.PROCESSING
            )

            print(f"[GraceAgent] Running InputGate for: '{input.text}'")

            # Pass state machine context to input gate
            async for output in self.input_gate.process(
                session_id=input.session_id,
                user_input=input.text,
                context=context,
                conversation_history=conversation_history,
                state_machine_context=sm_context
            ):
                yield output

            # Get gate result
            gate_result = self.input_gate.last_result
            if gate_result is None:
                yield AgentOutput.error(
                    input.session_id,
                    "Input gate processing failed",
                    error_type="gate_failure",
                    recoverable=True
                )
                return

            print(f"[GraceAgent] Gate result: {gate_result.route.value}")

            # Debug: Gate decision with full reasoning
            yield AgentOutput.debug(
                input.session_id,
                f"InputGate decided: {gate_result.route.value}",
                component="input_gate",
                stage="decision",
                route=gate_result.route.value,
                experts=gate_result.experts_to_consult,
                confidence=gate_result.confidence,
                reasoning=gate_result.reasoning,
                state_transition=gate_result.state_transition,
                deliverables_detected=list(gate_result.deliverables.keys()) if gate_result.deliverables else []
            )

            # Step 2: Handle routing
            if gate_result.route == GateRoute.SAFE:
                # SAFE route - InputGate already streamed the response
                # Note: Response is recorded by message-recorder, no need to track locally
                pass

            elif gate_result.route == GateRoute.UNSAFE:
                # UNSAFE route - need expert analysis
                expert_names = gate_result.experts_to_consult

                if expert_names:
                    print(f"[GraceAgent] Running ExpertPool with: {expert_names}")

                    # Status: THINKING - notify user we need to think about this
                    yield AgentOutput.status(
                        input.session_id,
                        "Let me think about this carefully...",
                        StatusSubtype.THINKING
                    )

                    # Start expert pool IMMEDIATELY in background (don't wait for interim message)
                    expert_outputs_queue: asyncio.Queue = asyncio.Queue()

                    async def run_experts_background():
                        """Run experts and queue their outputs."""
                        try:
                            async for output in self.expert_pool.run(
                                session_id=input.session_id,
                                user_input=input.text,
                                context=context,
                                expert_names=expert_names
                            ):
                                await expert_outputs_queue.put(output)
                        finally:
                            await expert_outputs_queue.put(None)  # Signal completion

                    # Start experts immediately in background
                    expert_task = asyncio.create_task(run_experts_background())

                    # Stream neutral interim message while experts are working
                    # Use a fixed neutral message, not the LLM's response (which might answer the question)
                    interim_message = "Let me think about that for a moment."
                    transcript_id = f"gate_ack_{uuid.uuid4().hex[:8]}"
                    words = interim_message.split()
                    accumulated = ""

                    for i, word in enumerate(words):
                        accumulated += word + " "
                        is_final = (i == len(words) - 1)

                        yield AgentOutput.text_chunk(
                            input.session_id,
                            accumulated.strip(),
                            transcript_id=transcript_id,
                            is_final=is_final
                        )

                        # Small delay for natural streaming feel
                        if not is_final:
                            await asyncio.sleep(0.02)

                    # Now yield expert outputs as they complete (experts may already be done)
                    while True:
                        output = await expert_outputs_queue.get()
                        if output is None:
                            break
                        yield output

                    # Ensure expert task is complete
                    await expert_task

                    # Get expert results
                    expert_results = self.expert_pool.last_results

                    print(f"[GraceAgent] Got {len(expert_results)} expert results")

                    # Status: AGGREGATING - synthesizing expert findings
                    yield AgentOutput.status(
                        input.session_id,
                        "Synthesizing insights...",
                        StatusSubtype.AGGREGATING
                    )

                    # Step 2b: Run Aggregator
                    async for output in self.aggregator.synthesize(
                        session_id=input.session_id,
                        user_input=input.text,
                        expert_results=expert_results,
                        input_gate_message=None,  # Don't pass gate message - we used a neutral interim
                        context=context,
                        state_machine_context=sm_context  # Pass plan context for deliverable-focused responses
                    ):
                        yield output

                    # Get aggregator result (used for verification, response already streamed)
                    agg_result = self.aggregator.last_result
                    # Note: Response is recorded by message-recorder, no need to track locally

                else:
                    # No experts selected but marked unsafe - stream neutral message
                    interim_message = "Let me think about that for a moment."
                    transcript_id = f"gate_fallback_{uuid.uuid4().hex[:8]}"
                    words = interim_message.split()
                    accumulated = ""

                    for i, word in enumerate(words):
                        accumulated += word + " "
                        is_final = (i == len(words) - 1)

                        yield AgentOutput.text_chunk(
                            input.session_id,
                            accumulated.strip(),
                            transcript_id=transcript_id,
                            is_final=is_final
                        )

                        if not is_final:
                            await asyncio.sleep(0.02)
                    # Note: Response is recorded by message-recorder, no need to track locally

            # Handle deliverables if detected
            if gate_result.deliverables:
                # Debug: Deliverables detected
                yield AgentOutput.debug(
                    input.session_id,
                    f"Extracted {len(gate_result.deliverables)} deliverables",
                    component="agent",
                    deliverable_keys=list(gate_result.deliverables.keys())
                )

                # Process deliverables through state machine
                if self.state_machine.is_initialized:
                    result = self.state_machine.process_deliverables(gate_result.deliverables)

                    # Handle state transitions
                    if result.should_advance and result.next_state_id:
                        old_state = self.state_machine.current_state
                        old_state_id = old_state.id if old_state else "Unknown"
                        old_state_title = old_state.title if old_state else "Unknown"

                        if self.state_machine.advance_state():
                            new_state = self.state_machine.current_state
                            new_state_id = new_state.id if new_state else "Unknown"
                            new_state_title = new_state.title if new_state else "Unknown"

                            yield AgentOutput.debug(
                                input.session_id,
                                f"State transition: {old_state_title} -> {new_state_title}",
                                component="state_machine",
                                stage="state_transition",
                                from_state_id=old_state_id,
                                from_state_title=old_state_title,
                                to_state_id=new_state_id,
                                to_state_title=new_state_title,
                                transition_reason=result.transition_reason or "all_tasks_complete",
                                completed_tasks=result.completed_tasks
                            )

                # Emit deliverables via SDK
                for key, value in gate_result.deliverables.items():
                    yield AgentOutput.deliverable(
                        input.session_id,
                        key=key,
                        value=value
                    )
            else:
                # No deliverables extracted - increment turn counter
                if self.state_machine.is_initialized:
                    self.state_machine.increment_turn()

            # Emit todo list state via debug message
            if self.state_machine.is_initialized:
                todo_list = self.state_machine.get_todo_list()
                if todo_list:
                    # Clear state changed flag after processing
                    self.state_machine.clear_state_changed_flag()

                    yield AgentOutput.debug(
                        input.session_id,
                        "Todo list state updated",
                        component="state_machine",
                        stage="todo_update",
                        todo_list=todo_list.to_dict()
                    )

        except Exception as e:
            print(f"[GraceAgent] Processing error: {e}")
            yield AgentOutput.error(
                input.session_id,
                f"Processing error: {str(e)}",
                error_type="processing_error",
                recoverable=True
            )

        finally:
            self._is_processing = False

    async def on_interrupt(self, session_id: str) -> None:
        """
        Handle user interrupt (barge-in).

        Cancels all ongoing pipeline processing.
        """
        print(f"[GraceAgent] Interrupt received for session: {session_id}")

        self.input_gate.cancel()
        self.expert_pool.cancel()
        self.aggregator.cancel()

        self._is_processing = False

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize session state.

        Args:
            session_id: Unique session identifier
            config: Agent-specific configuration from AGENT_CONFIG env var
                   For GraceAgent, may include:
                   - "plan_id": ID of plan to load (e.g., "grace_smalltalk")
                   - "plan": Direct plan configuration (legacy support)
                   - "model": LLM model override
                   - "temperature": LLM temperature override
        """
        await super().on_session_start(session_id, config)

        self.config = config

        # Initialize state machine from plan
        plan = None

        # First check for plan_id - load plan from disk
        if "plan_id" in config:
            plan_id = config["plan_id"]
            plan = self._load_plan(plan_id)
            if plan:
                print(f"[GraceAgent] Loaded plan '{plan_id}' from disk")
            else:
                print(f"[GraceAgent] Failed to load plan '{plan_id}'")

        # Legacy support: direct plan in config
        elif "plan" in config:
            plan = config["plan"]
            print(f"[GraceAgent] Using direct plan from config")

        # Initialize state machine if we have a plan
        if plan:
            if self.state_machine.initialize(plan):
                print(f"[GraceAgent] State machine initialized with plan: {plan.get('title', 'Unknown')}")
            else:
                print(f"[GraceAgent] Failed to initialize state machine from plan")
        else:
            print(f"[GraceAgent] No plan_id or plan in config - state machine disabled")

        # Apply any config overrides
        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        print(f"[GraceAgent] Session started: {session_id}")
        print(f"[GraceAgent] Config keys: {list(config.keys())}")

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """
        Cleanup and return final data.

        Returns:
            Dict with session summary data including state machine state
        """
        result = await super().on_session_end(session_id)

        # Build summary
        summary = {
            "llm_stats": self.llm_service.get_usage_stats(),
            **result
        }

        # Add state machine summary if initialized
        if self.state_machine.is_initialized:
            todo_list = self.state_machine.get_todo_list()
            if todo_list:
                summary["state_machine"] = {
                    "plan_id": todo_list.plan_id,
                    "plan_title": todo_list.plan_title,
                    "final_state": todo_list.current_state_id,
                    "progress_percentage": todo_list.progress_percentage,
                    "completed_deliverables": todo_list.completed_deliverables
                }

        # Reset state machine for next session
        self.state_machine = StateMachine()

        # Clear config
        self.config = {}

        print(f"[GraceAgent] Session ended: {session_id}")
        print(f"[GraceAgent] Summary: {summary}")

        return summary

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Handle runtime configuration update.

        Args:
            session_id: Session identifier
            config: Updated configuration
        """
        await super().on_config_update(session_id, config)

        # Merge config
        self.config.update(config)

        # Apply LLM config overrides
        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        print(f"[GraceAgent] Config updated: {config}")

    def _load_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a plan configuration from disk by plan ID.

        Plans are stored as JSON files in the config/plans directory.
        Plan ID is the filename without extension (e.g., "grace_smalltalk").

        Args:
            plan_id: The plan identifier (filename without .json)

        Returns:
            Plan configuration dict or None if not found
        """
        import json
        import os

        # Try multiple locations for plans directory
        # 1. Environment variable (for Docker/production)
        # 2. /app/grace-agent/config/plans (Docker default)
        # 3. Relative to package source (development)
        possible_paths = []

        # Check environment variable first
        if os.environ.get("GRACE_PLANS_DIR"):
            possible_paths.append(Path(os.environ["GRACE_PLANS_DIR"]))

        # Docker default path
        possible_paths.append(Path("/app/grace-agent/config/plans"))

        # Development path (relative to source)
        package_dir = Path(__file__).parent
        possible_paths.append(package_dir.parent.parent / "config" / "plans")

        # Find the first existing plans directory
        plans_dir = None
        for path in possible_paths:
            if path.exists() and path.is_dir():
                plans_dir = path
                break

        if not plans_dir:
            print(f"[GraceAgent] No plans directory found. Searched: {possible_paths}")
            return None

        # Construct plan file path
        plan_file = plans_dir / f"{plan_id}.json"

        if not plan_file.exists():
            print(f"[GraceAgent] Plan file not found: {plan_file}")
            return None

        try:
            with open(plan_file, "r", encoding="utf-8") as f:
                plan = json.load(f)
            print(f"[GraceAgent] Loaded plan from {plan_file}")
            return plan
        except json.JSONDecodeError as e:
            print(f"[GraceAgent] Invalid JSON in plan file {plan_file}: {e}")
            return None
        except Exception as e:
            print(f"[GraceAgent] Failed to load plan {plan_file}: {e}")
            return None

    def _find_config_file(self, relative_path: str) -> Optional[str]:
        """
        Find a config file by trying multiple locations.

        Args:
            relative_path: Path relative to grace-agent root (e.g., "config/llm_config.json")

        Returns:
            Absolute path to config file or None if not found
        """
        possible_paths = []

        # Docker default path
        possible_paths.append(Path(f"/app/grace-agent/{relative_path}"))

        # Development path (relative to package source)
        package_dir = Path(__file__).parent
        possible_paths.append(package_dir.parent.parent / relative_path)

        # Current working directory
        possible_paths.append(Path(relative_path))

        for path in possible_paths:
            if path.exists():
                print(f"[GraceAgent] Found config file: {path}")
                return str(path)

        print(f"[GraceAgent] Config file not found: {relative_path}")
        return None

    def _find_experts_dir(self) -> str:
        """
        Find the experts directory by trying multiple locations.

        Returns:
            Path to experts directory
        """
        possible_paths = []

        # Docker default path
        possible_paths.append(Path("/app/grace-agent/src/grace_agent/experts"))

        # Development path (relative to package source)
        package_dir = Path(__file__).parent
        possible_paths.append(package_dir / "experts")

        # Current working directory
        possible_paths.append(Path("experts"))

        for path in possible_paths:
            if path.exists() and path.is_dir():
                print(f"[GraceAgent] Found experts directory: {path}")
                return str(path)

        print(f"[GraceAgent] Experts directory not found, using default 'experts'")
        return "experts"

    async def _fetch_conversation_history(self, limit: int = 20) -> List[Dict[str, str]]:
        """
        Fetch conversation history from database.

        The agent is stateless - it fetches history on-demand from the database
        via the SDK's get_chat_history() method instead of storing it in memory.

        Args:
            limit: Max messages to fetch (default 20 for context window)

        Returns:
            List of messages in format [{"role": "user/assistant", "content": "..."}]
        """
        if not self.has_history:
            print(f"[GraceAgent] Chat history not available (has_history={self.has_history}, _history_client={self._history_client})")
            return []

        try:
            print(f"[GraceAgent] Fetching chat history (limit={limit})...")
            messages = await self.get_chat_history(include_debug=False, limit=limit)
            print(f"[GraceAgent] Fetched {len(messages)} messages from chat history")

            # Convert ChatMessage to simple dict format for LLM
            history = []
            for msg in messages:
                role = "user" if msg.role == "user" else "assistant"
                if msg.content.strip():  # Skip empty messages
                    history.append({
                        "role": role,
                        "content": msg.content
                    })

            return history
        except Exception as e:
            print(f"[GraceAgent] Failed to fetch history: {e}")
            return []

    def _build_context(self, conversation_history: List[Dict[str, str]]) -> str:
        """Build context string from conversation history."""
        if not conversation_history:
            return ""

        # Take last 10 messages for context
        recent = conversation_history[-10:]

        context_parts = []
        for msg in recent:
            role = msg["role"].upper()
            content = msg["content"]
            context_parts.append(f"[{role}]: {content}")

        return "\n".join(context_parts)
