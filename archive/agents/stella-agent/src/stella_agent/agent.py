"""
Stella Agent - Full agent implementation using the STELLA Agent SDK.

This agent implements the InputGate → ExpertPool → Aggregator pipeline
for intelligent conversation handling with expert consultation.

Includes State Machine integration for plan-based conversation flow
with task tracking and deliverable collection.

Supports both:
- Tool-based state management (via gRPC to external state machine service)
- Legacy text-parsing state management (local state machine)
"""

import asyncio
import os
import time
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional
import uuid

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype
from stella_agent_sdk.tools import ToolRegistry
from stella_agent_sdk.tools.state_machine import create_state_machine_tools
from stella_agent_sdk.services.state_machine_client import StateMachineClient

from stella_agent.llm.service import LLMService
from stella_agent.pipeline.input_gate import InputGate
from stella_agent.pipeline.expert_pool import ExpertPool
from stella_agent.pipeline.aggregator import Aggregator
from stella_agent.models.gate_result import GateRoute
from stella_agent.state_machine import StateMachine
from stella_agent.prompts.builder import PromptBuilder
from stella_agent.adapters import ProgressAdapter


class StellaAgent(BaseAgent):
    """
    Stella Agent that implements intelligent conversation handling.

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
        experts_dir: Optional[str] = None,
        use_tools: bool = False,  # Default to legacy mode for stella-agent
        state_machine_address: Optional[str] = None
    ):
        """
        Initialize the Stella Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file
            experts_dir: Path to directory containing expert JSON configs
            use_tools: If True, use tool-based state management via gRPC.
                      If False, use legacy text parsing with local state machine.
            state_machine_address: gRPC address for state machine service
        """
        super().__init__()

        # Set agent type to match the Docker image name (used for gRPC registration)
        self._agent_type = "stella-agent"

        # Mode configuration
        self._use_tools = use_tools

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

        # Initialize prompt builder
        self.prompt_builder = PromptBuilder()

        # Tool-based components (initialized per session)
        # State machine shares the same gRPC port as agent registration (50051)
        self._state_machine_address = state_machine_address or os.environ.get(
            "STATE_MACHINE_ADDRESS", "localhost:50051"
        )
        self.sm_client: Optional[StateMachineClient] = None
        self.tool_registry: Optional[ToolRegistry] = None

        # Legacy state machine (for backward compatibility)
        self.state_machine: Optional[StateMachine] = None
        if not use_tools:
            self.state_machine = StateMachine()

        # Timekeeper threshold (turns without deliverable before invoking)
        self.timekeeper_threshold = 2

        # Session config (no conversation state - fetched on demand)
        self.config: Dict[str, Any] = {}

        # Track session start time for elapsed time calculation
        self._session_started_at: Optional[str] = None

        # Custom system prompt from plan (set in on_session_start)
        self._plan_system_prompt: Optional[str] = None

        mode_str = "tool-based" if use_tools else "legacy"
        print(f"[StellaAgent] Initialized ({mode_str} mode) with {len(self.expert_pool.agents)} experts")

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
        t_pipeline_start = time.perf_counter()
        turn_id = getattr(self._audio_pipeline, '_turn_id', None) or "" if hasattr(self, '_audio_pipeline') else ""

        try:
            # Fetch conversation history from database (stateless - no in-memory storage)
            conversation_history = await self._fetch_conversation_history(limit=20)

            # Get state machine context for prompts
            sm_context = {}
            if self.state_machine.is_initialized:
                sm_context = self.state_machine.get_context_for_prompt()
            # Add custom system prompt from plan if available
            if self._plan_system_prompt:
                sm_context["plan_system_prompt"] = self._plan_system_prompt

            # Build context from fetched history
            context = self._build_context(conversation_history)

            # Step 1: Run InputGate
            yield AgentOutput.status(
                input.session_id,
                "Processing your message...",
                StatusSubtype.PROCESSING
            )

            print(f"[StellaAgent] Running InputGate for: '{input.text}'")

            # Pass state machine context to input gate
            t_gate_start = time.perf_counter()
            async for output in self.input_gate.process(
                session_id=input.session_id,
                user_input=input.text,
                context=context,
                conversation_history=conversation_history,
                state_machine_context=sm_context
            ):
                yield output
            yield AgentOutput.analytics(
                input.session_id,
                stage="input_gate",
                timing_ms=(time.perf_counter() - t_gate_start) * 1000,
                turn_id=turn_id,
            )

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

            print(f"[StellaAgent] Gate result: {gate_result.route.value}")

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

            # Analytics: safety routing decision
            yield AgentOutput.analytics(
                input.session_id, stage="safety_routing", timing_ms=0,
                route=gate_result.route.value,
                experts_consulted=gate_result.experts_to_consult,
                confidence=gate_result.confidence,
                turn_id=turn_id,
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
                    print(f"[StellaAgent] Running ExpertPool with: {expert_names}")

                    # Status: THINKING - notify user we need to think about this
                    yield AgentOutput.status(
                        input.session_id,
                        "Let me think about this carefully...",
                        StatusSubtype.THINKING
                    )

                    # Start expert pool IMMEDIATELY in background (don't wait for interim message)
                    t_experts_start = time.perf_counter()
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

                    t_bridge_start = time.perf_counter()
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
                    t_bridge_end = time.perf_counter()

                    # Now yield expert outputs as they complete (experts may already be done)
                    while True:
                        output = await expert_outputs_queue.get()
                        if output is None:
                            break
                        yield output

                    # Ensure expert task is complete
                    await expert_task

                    # Analytics: bridge generation (interim message only, excludes expert runtime)
                    yield AgentOutput.analytics(
                        input.session_id, stage="bridge_generation",
                        timing_ms=(t_bridge_end - t_bridge_start) * 1000,
                        bridge_fired=True, turn_id=turn_id,
                    )

                    # Get expert results
                    expert_results = self.expert_pool.last_results
                    yield AgentOutput.analytics(
                        input.session_id,
                        stage="expert_pool",
                        timing_ms=(time.perf_counter() - t_experts_start) * 1000,
                        expert_count=len(expert_results),
                        turn_id=turn_id,
                    )

                    print(f"[StellaAgent] Got {len(expert_results)} expert results")

                    # Status: AGGREGATING - synthesizing expert findings
                    yield AgentOutput.status(
                        input.session_id,
                        "Synthesizing insights...",
                        StatusSubtype.AGGREGATING
                    )

                    # Step 2b: Run Aggregator
                    t_agg_start = time.perf_counter()
                    async for output in self.aggregator.synthesize(
                        session_id=input.session_id,
                        user_input=input.text,
                        expert_results=expert_results,
                        input_gate_message=None,  # Don't pass gate message - we used a neutral interim
                        context=context,
                        state_machine_context=sm_context  # Pass plan context for deliverable-focused responses
                    ):
                        yield output
                    yield AgentOutput.analytics(
                        input.session_id,
                        stage="aggregator",
                        timing_ms=(time.perf_counter() - t_agg_start) * 1000,
                        turn_id=turn_id,
                    )

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

                            # Analytics: state transition
                            yield AgentOutput.analytics(
                                input.session_id, stage="state_transition", timing_ms=0,
                                from_state=old_state_id, to_state=new_state_id,
                                transition_reason=result.transition_reason or "all_tasks_complete",
                                was_expected=True, turn_id=turn_id,
                            )

                # Emit deliverables via SDK
                for key, value in gate_result.deliverables.items():
                    yield AgentOutput.deliverable(
                        input.session_id,
                        key=key,
                        value=value
                    )

            # Handle explicitly completed tasks (tasks without deliverables)
            if gate_result.completed_tasks:
                print(f"[StellaAgent] Explicitly completed tasks from LLM: {gate_result.completed_tasks}")

                yield AgentOutput.debug(
                    input.session_id,
                    f"Explicitly completed {len(gate_result.completed_tasks)} tasks",
                    component="agent",
                    completed_task_ids=gate_result.completed_tasks
                )

                if self.state_machine.is_initialized:
                    marked = self.state_machine.mark_tasks_completed(gate_result.completed_tasks)
                    print(f"[StellaAgent] Successfully marked tasks: {marked}")

                    # Check for state transitions after marking tasks complete
                    result = self.state_machine.process_deliverables({})
                    print(f"[StellaAgent] After process_deliverables: "
                          f"state_complete={result.state_complete}, "
                          f"should_advance={result.should_advance}, "
                          f"next_state={result.next_state_id}")
                    if result.should_advance and result.next_state_id:
                        print(f"[StellaAgent] Advancing to state: {result.next_state_id}")
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
                                transition_reason="explicit_task_completion",
                                completed_tasks=gate_result.completed_tasks
                            )

                            # Analytics: state transition (explicit completion)
                            yield AgentOutput.analytics(
                                input.session_id, stage="state_transition", timing_ms=0,
                                from_state=old_state_id, to_state=new_state_id,
                                transition_reason="explicit_task_completion",
                                was_expected=True, turn_id=turn_id,
                            )

            # No deliverables or completed tasks - increment turn counter
            if not gate_result.deliverables and not gate_result.completed_tasks:
                if self.state_machine.is_initialized:
                    self.state_machine.increment_turn()

            # Emit progress update via dedicated message type
            if self.state_machine.is_initialized:
                execution_state = self.state_machine.execution_state
                if execution_state:
                    # Clear state changed flag after processing
                    self.state_machine.clear_state_changed_flag()

                    # Convert to generic SDK progress state
                    progress_state = ProgressAdapter.from_execution_state(
                        execution_state,
                        started_at=self._session_started_at
                    )

                    yield AgentOutput.progress_update(
                        input.session_id,
                        progress_state,
                        update_trigger="turn_completion",
                        agent_name=self.agent_name,
                        agent_icon="🤖"
                    )

            # Emit total pipeline timing
            yield AgentOutput.analytics(
                input.session_id,
                stage="total",
                timing_ms=(time.perf_counter() - t_pipeline_start) * 1000,
                turn_id=turn_id,
            )

        except Exception as e:
            print(f"[StellaAgent] Processing error: {e}")
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
        print(f"[StellaAgent] Interrupt received for session: {session_id}")

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
                   For StellaAgent, may include:
                   - "plan_id": ID of plan to load (e.g., "stella_smalltalk")
                   - "plan": Direct plan configuration (legacy support)
                   - "model": LLM model override
                   - "temperature": LLM temperature override
        """
        await super().on_session_start(session_id, config)

        from datetime import datetime
        self._session_started_at = datetime.utcnow().isoformat() + "Z"
        self.config = config
        self._plan_system_prompt = None

        # Load plan configuration
        plan = self._load_plan_config(config)

        if self._use_tools:
            # Initialize tool-based state management
            await self._init_tool_mode(session_id, plan)
        else:
            # Initialize legacy state machine
            await self._init_legacy_mode(plan)

        # Extract custom system prompt from plan if provided
        if plan and "system_prompt" in plan:
            self._plan_system_prompt = plan["system_prompt"]
            print("[StellaAgent] Using custom system prompt from plan")

        # Apply any config overrides
        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        print(f"[StellaAgent] Session started: {session_id}")
        print(f"[StellaAgent] Config keys: {list(config.keys())}")

    def _load_plan_config(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Load plan configuration from config or disk."""
        plan = None

        # First check for plan_id - load plan from disk
        if "plan_id" in config:
            plan_id = config["plan_id"]
            plan = self._load_plan(plan_id)
            if plan:
                print(f"[StellaAgent] Loaded plan '{plan_id}' from disk")
            else:
                print(f"[StellaAgent] Failed to load plan '{plan_id}'")

        # Legacy support: direct plan in config
        elif "plan" in config:
            plan = config["plan"]
            print("[StellaAgent] Using direct plan from config")

        return plan

    async def _init_tool_mode(
        self, session_id: str, plan: Optional[Dict[str, Any]]
    ) -> None:
        """Initialize tool-based state management."""
        # Create state machine client
        self.sm_client = StateMachineClient(
            session_id=session_id,
            address=self._state_machine_address
        )

        # Initialize state machine with plan
        if plan:
            try:
                result = await self.sm_client.initialize(plan)
                print(f"[StellaAgent] State machine initialized via gRPC: {result.get('success')}")
            except Exception as e:
                print(f"[StellaAgent] Failed to initialize state machine: {e}")

        # Create tool registry and register state machine tools
        self.tool_registry = ToolRegistry()
        sm_tools = create_state_machine_tools(self.sm_client)
        for tool in sm_tools:
            self.tool_registry.register(tool)

        print(f"[StellaAgent] Registered {len(sm_tools)} state machine tools")

    async def _init_legacy_mode(self, plan: Optional[Dict[str, Any]]) -> None:
        """Initialize legacy text-parsing state management."""
        if plan:
            if self.state_machine.initialize(plan):
                print(f"[StellaAgent] State machine initialized with plan: {plan.get('title', 'Unknown')}")
            else:
                print("[StellaAgent] Failed to initialize state machine from plan")
        else:
            print("[StellaAgent] No plan_id or plan in config - state machine disabled")

    async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
        """
        Send initial progress state when agent joins the room.

        This allows the frontend to display the todo list immediately
        when the agent connects, before any user interaction.
        """
        if self.state_machine.is_initialized:
            execution_state = self.state_machine.execution_state
            if execution_state:
                print(f"[StellaAgent] Sending initial progress state")

                # Convert to generic SDK progress state
                progress_state = ProgressAdapter.from_execution_state(
                    execution_state,
                    started_at=self._session_started_at
                )

                yield AgentOutput.progress_update(
                    session_id,
                    progress_state,
                    update_trigger="session_start",
                    agent_name=self.agent_name,
                    agent_icon="🤖"
                )
        else:
            print(f"[StellaAgent] No state machine initialized - skipping initial progress")

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """
        Cleanup and return final data.

        Returns:
            Dict with session summary data including state machine state
        """
        result = await super().on_session_end(session_id)

        # Build summary
        summary = {
            "agent": "stella-agent",
            "mode": "tool-based" if self._use_tools else "legacy",
            "llm_stats": self.llm_service.get_usage_stats(),
            **result
        }

        if self._use_tools and self.sm_client:
            # Get summary from external state machine
            try:
                state = await self.sm_client.get_current_state()
                deliverables = await self.sm_client.get_collected_deliverables()
                summary["deliverables"] = deliverables
                summary["progress"] = state.get("progress", 0) if state else 0
            except Exception as e:
                print(f"[StellaAgent] Failed to get session summary: {e}")

            # Close state machine client
            await self.sm_client.close()
            self.sm_client = None
            self.tool_registry = None

        elif self.state_machine and self.state_machine.is_initialized:
            # Add state machine summary if initialized (legacy mode)
            todo_list = self.state_machine.get_todo_list()
            if todo_list:
                # Analytics: plan completion
                total = todo_list.total_items
                completed = todo_list.completed_items
                rate = (completed / total) if total > 0 else 0.0
                reached_end = todo_list.progress_percentage >= 100.0

                if self.has_audio:
                    try:
                        await self.audio._room.publish_data({
                            "type": "analytics",
                            "data": {
                                "stage": "plan_completion", "timing_ms": 0,
                                "total_tasks": total, "completed_tasks": completed,
                                "completion_rate": rate, "plan_reached_end": reached_end,
                                "plan_id": todo_list.plan_id,
                            }
                        })
                    except Exception:
                        pass  # Room may be closing

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

        print(f"[StellaAgent] Session ended: {session_id}")
        print(f"[StellaAgent] Summary: {summary}")

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

        print(f"[StellaAgent] Config updated: {config}")

    def _load_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a plan configuration from disk by plan ID.

        Plans are stored as JSON files in the config/plans directory.
        Plan ID is the filename without extension (e.g., "stella_smalltalk").

        Args:
            plan_id: The plan identifier (filename without .json)

        Returns:
            Plan configuration dict or None if not found
        """
        import json
        import os

        # Try multiple locations for plans directory
        # 1. Environment variable (for Docker/production)
        # 2. /app/stella-agent/config/plans (Docker default)
        # 3. Relative to package source (development)
        possible_paths = []

        # Check environment variable first
        if os.environ.get("STELLA_PLANS_DIR"):
            possible_paths.append(Path(os.environ["STELLA_PLANS_DIR"]))

        # Docker default path
        possible_paths.append(Path("/app/stella-agent/config/plans"))

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
            print(f"[StellaAgent] No plans directory found. Searched: {possible_paths}")
            return None

        # Construct plan file path
        plan_file = plans_dir / f"{plan_id}.json"

        if not plan_file.exists():
            print(f"[StellaAgent] Plan file not found: {plan_file}")
            return None

        try:
            with open(plan_file, "r", encoding="utf-8") as f:
                plan = json.load(f)
            print(f"[StellaAgent] Loaded plan from {plan_file}")
            return plan
        except json.JSONDecodeError as e:
            print(f"[StellaAgent] Invalid JSON in plan file {plan_file}: {e}")
            return None
        except Exception as e:
            print(f"[StellaAgent] Failed to load plan {plan_file}: {e}")
            return None

    def _find_config_file(self, relative_path: str) -> Optional[str]:
        """
        Find a config file by trying multiple locations.

        Args:
            relative_path: Path relative to stella-agent root (e.g., "config/llm_config.json")

        Returns:
            Absolute path to config file or None if not found
        """
        possible_paths = []

        # Docker default path
        possible_paths.append(Path(f"/app/stella-agent/{relative_path}"))

        # Development path (relative to package source)
        package_dir = Path(__file__).parent
        possible_paths.append(package_dir.parent.parent / relative_path)

        # Current working directory
        possible_paths.append(Path(relative_path))

        for path in possible_paths:
            if path.exists():
                print(f"[StellaAgent] Found config file: {path}")
                return str(path)

        print(f"[StellaAgent] Config file not found: {relative_path}")
        return None

    def _find_experts_dir(self) -> str:
        """
        Find the experts directory by trying multiple locations.

        Returns:
            Path to experts directory
        """
        possible_paths = []

        # Docker default path
        possible_paths.append(Path("/app/stella-agent/src/stella_agent/experts"))

        # Development path (relative to package source)
        package_dir = Path(__file__).parent
        possible_paths.append(package_dir / "experts")

        # Current working directory
        possible_paths.append(Path("experts"))

        for path in possible_paths:
            if path.exists() and path.is_dir():
                print(f"[StellaAgent] Found experts directory: {path}")
                return str(path)

        print(f"[StellaAgent] Experts directory not found, using default 'experts'")
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
            print(f"[StellaAgent] Chat history not available (has_history={self.has_history}, _history_client={self._history_client})")
            return []

        try:
            print(f"[StellaAgent] Fetching chat history (limit={limit})...")
            messages = await self.get_chat_history(include_debug=False, limit=limit)
            print(f"[StellaAgent] Fetched {len(messages)} messages from chat history")

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
            print(f"[StellaAgent] Failed to fetch history: {e}")
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
