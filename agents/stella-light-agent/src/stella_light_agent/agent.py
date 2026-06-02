"""
Stella Light Agent - Simplified single-LLM agent with prompt-based guardrails.

This is a lightweight version of stella-agent that:
- Uses a single LLM call instead of InputGate/ExpertPool/Aggregator pipeline
- Embeds safety guardrails directly in the system prompt
- Supports tool-based state management (via gRPC) or legacy text parsing
- Supports streaming responses
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype
from stella_agent_sdk.tools import ToolRegistry
from stella_agent_sdk.tools.state_machine import create_state_machine_tools
from stella_agent_sdk.services.state_machine_client import StateMachineClient

from stella_light_agent.llm.service import LLMService
from stella_light_agent.processor import LightProcessor, ProcessorResult
from stella_light_agent.tool_processor import ToolProcessor, ToolProcessorResult
from stella_light_agent.state_machine import StateMachine
from stella_light_agent.prompts import LightPromptBuilder
from stella_agent_sdk.prompts import get_compiler
from stella_light_agent.adapters import ProgressAdapter


class StellaLightAgent(BaseAgent):
    """
    Stella Light Agent - Simplified single-LLM agent.

    Processing Flow (Tool Mode):
    1. Build unified prompt with state context + guardrails
    2. Single LLM call with tool calling
    3. Execute tools (set_deliverable, complete_task)
    4. State machine updates via gRPC
    5. Emit progress update

    Processing Flow (Legacy Mode):
    1. Build unified prompt with structured output format
    2. Single LLM call with streaming response
    3. Parse deliverables/tasks from text
    4. Update local state machine
    5. Emit progress update
    """

    def __init__(
        self,
        llm_config_path: Optional[str] = None,
        use_tools: bool = True,  # Default to tool mode
        state_machine_address: Optional[str] = None
    ):
        """
        Initialize the Stella Light Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file
            use_tools: If True, use tool-based state management via gRPC.
                      If False, use legacy text parsing with local state machine.
            state_machine_address: gRPC address for state machine service
        """
        super().__init__()

        # Set agent type to match the Docker image name (used for gRPC registration)
        self._agent_type = "stella-light-agent"

        # Mode configuration
        self._use_tools = use_tools

        # Determine config path
        if llm_config_path is None:
            llm_config_path = self._find_config_file("config/llm_config.json")

        # Initialize LLM service
        self.llm_service = LLMService(config_path=llm_config_path)

        # Initialize prompt builder with tool mode
        self.prompt_builder = LightPromptBuilder(use_tools=use_tools)

        # Tool-based components (initialized per session)
        # State machine shares the same gRPC port as agent registration (50051)
        self._state_machine_address = state_machine_address or os.environ.get(
            "STATE_MACHINE_ADDRESS", "localhost:50051"
        )
        self.sm_client: Optional[StateMachineClient] = None
        self.tool_registry: Optional[ToolRegistry] = None
        self.tool_processor: Optional[ToolProcessor] = None

        # Legacy components (for backward compatibility)
        self.legacy_processor: Optional[LightProcessor] = None
        self.state_machine: Optional[StateMachine] = None

        if not use_tools:
            # Initialize legacy components
            self.legacy_processor = LightProcessor(llm_service=self.llm_service)
            self.state_machine = StateMachine()

        # Session config
        self.config: Dict[str, Any] = {}
        self._session_started_at: Optional[str] = None
        self._plan_system_prompt: Optional[str] = None
        # Configurator overrides injected via SDK config (pipeline_config), mirroring stella-v2.
        self._custom_persona: Optional[str] = None
        self._custom_guidelines: Optional[str] = None
        self._history_limit: int = 20

        mode_str = "tool-based" if use_tools else "legacy"
        print(f"[StellaLightAgent] Initialized ({mode_str} mode)")

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

    def _apply_pipeline_config(self, pipeline_config: Dict[str, Any]) -> None:
        """Apply Agent Configurator overrides injected via SDK config.

        Reads the single 'response' node and the 'history_limit' threshold from the
        pipeline_config dict (shape: { nodes: {...}, thresholds: {...} }) and applies
        them to the LLM service and prompt builder. Mirrors stella-v2's
        _apply_pipeline_config but for the light agent's single-LLM architecture.
        """
        nodes = pipeline_config.get("nodes", {}) or {}
        thresholds = pipeline_config.get("thresholds", {}) or {}

        response = nodes.get("response", {}) or {}
        if "model" in response:
            self.llm_service.default_config.model = response["model"]
        if "temperature" in response:
            self.llm_service.default_config.temperature = float(response["temperature"])
        if "max_tokens" in response:
            self.llm_service.default_config.max_tokens = int(response["max_tokens"])
        if response.get("persona"):
            self._custom_persona = response["persona"]
        if response.get("conversation_guidelines"):
            self._custom_guidelines = response["conversation_guidelines"]

        if "history_limit" in thresholds:
            try:
                self._history_limit = int(thresholds["history_limit"])
            except (TypeError, ValueError):
                pass

        print(
            f"[StellaLightAgent] Pipeline config applied: "
            f"model={self.llm_service.default_config.model}, "
            f"temperature={self.llm_service.default_config.temperature}, "
            f"max_tokens={self.llm_service.default_config.max_tokens}, "
            f"persona={'custom' if self._custom_persona else 'default'}, "
            f"guidelines={'custom' if self._custom_guidelines else 'default'}, "
            f"history_limit={self._history_limit}"
        )

    def _inject_configured_prompts(
        self,
        sm_context: Dict[str, Any],
        conversation_history: List[Dict[str, str]],
        user_input: str,
    ) -> None:
        """Resolve {{placeholder}} tokens in configured prompts and inject them.

        Mirrors stella-v2's template compilation so the Configurator's persona /
        conversation_guidelines and the plan system prompt can reference live runtime
        values ({{plan}}, {{current_focus}}, {{history_N}}, {{user_message}}, ...).
        Compiled per turn because history/user-message placeholders change each turn.
        """
        # Ring up the placeholder compiler from the SDK, bound to this turn's
        # runtime context, then resolve placeholders in each configured prompt.
        compiler = get_compiler("placeholder")(
            sm_context,
            conversation_history=conversation_history,
            user_input=user_input,
        )

        if self._custom_persona:
            sm_context["custom_persona"] = compiler.compile(self._custom_persona)
        if self._custom_guidelines:
            sm_context["custom_guidelines"] = compiler.compile(self._custom_guidelines)
        # The plan system prompt may also contain placeholders.
        if sm_context.get("plan_system_prompt"):
            sm_context["plan_system_prompt"] = compiler.compile(sm_context["plan_system_prompt"])

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """
        Initialize session with configuration.

        Args:
            session_id: Unique session identifier
            config: Session configuration including plan
        """
        self.config = config
        self._session_started_at = datetime.now(timezone.utc).isoformat()
        self._plan_system_prompt = None
        self._custom_persona = None
        self._custom_guidelines = None
        self._history_limit = 20

        print(f"[StellaLightAgent] Session started: {session_id}")
        print(f"[StellaLightAgent] Config keys: {list(config.keys())}")

        # Load plan configuration
        plan_config = self._load_plan_config(config)

        if self._use_tools:
            # Initialize tool-based state management
            await self._init_tool_mode(session_id, plan_config)
        else:
            # Initialize legacy state machine
            await self._init_legacy_mode(plan_config)

        # Extract custom system prompt from plan if provided
        if plan_config and "system_prompt" in plan_config:
            self._plan_system_prompt = plan_config["system_prompt"]
            print("[StellaLightAgent] Using custom system prompt from plan")

        # Apply LLM config overrides
        llm_overrides = config.get("llm", {})
        if llm_overrides:
            if "model" in llm_overrides:
                self.llm_service.default_config.model = llm_overrides["model"]
            if "temperature" in llm_overrides:
                self.llm_service.default_config.temperature = llm_overrides["temperature"]

        # Apply pipeline configuration from the Agent Configurator (same principle as
        # stella-v2): persona/guidelines/model/temperature/max_tokens + history_limit
        # injected through the SDK config as pipeline_config.
        pipeline_config = config.get("pipeline_config")
        if pipeline_config:
            self._apply_pipeline_config(pipeline_config)

    def _load_plan_config(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Load plan configuration from config or disk."""
        plan_config = None

        # First check for plan_id - load plan from disk
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

        return plan_config

    async def _init_tool_mode(
        self, session_id: str, plan_config: Optional[Dict[str, Any]]
    ) -> None:
        """Initialize tool-based state management."""
        # Create state machine client and connect
        self.sm_client = StateMachineClient(
            session_id=session_id,
            address=self._state_machine_address
        )
        await self.sm_client.connect()
        print(f"[StellaLightAgent] Connected to state machine at {self._state_machine_address}")

        # Initialize state machine with plan
        if plan_config:
            try:
                result = await self.sm_client.initialize(plan_config)
                print(f"[StellaLightAgent] State machine initialized: {result.get('success')}")
            except Exception as e:
                print(f"[StellaLightAgent] Failed to initialize state machine: {e}")

        # Create tool registry and register state machine tools
        self.tool_registry = ToolRegistry()
        sm_tools = create_state_machine_tools(self.sm_client)
        for tool in sm_tools:
            self.tool_registry.register(tool)

        print(f"[StellaLightAgent] Registered {len(sm_tools)} state machine tools")

        # Create tool processor
        self.tool_processor = ToolProcessor(
            llm_service=self.llm_service,
            tool_registry=self.tool_registry
        )

    async def _init_legacy_mode(self, plan_config: Optional[Dict[str, Any]]) -> None:
        """Initialize legacy text-parsing state management."""
        if plan_config:
            success = self.state_machine.initialize(plan_config)
            print(f"[StellaLightAgent] State machine initialized: {success}")
        else:
            print("[StellaLightAgent] No plan_id or plan in config - state machine disabled")

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
        print(f"[StellaLightAgent] on_ready called, use_tools={self._use_tools}, sm_client={self.sm_client is not None}")

        if self._use_tools:
            # Get full progress from external state machine
            if self.sm_client:
                try:
                    print("[StellaLightAgent] Fetching full state from state machine...")
                    full_state = await self.sm_client.get_full_state()
                    print(f"[StellaLightAgent] Full state received: {full_state is not None}, keys: {list(full_state.keys()) if full_state else 'None'}")

                    if full_state:
                        progress_state = self._build_progress_from_full_state(full_state)
                        print(f"[StellaLightAgent] Built progress state with {len(progress_state.get('groups', []))} groups")
                        yield AgentOutput.progress_update(
                            session_id,
                            progress_state,
                            update_trigger="session_start",
                            agent_name="stella-light-agent",
                            agent_icon="💡"
                        )
                        print("[StellaLightAgent] Progress update yielded")
                    else:
                        print("[StellaLightAgent] No full state returned - state machine may not be initialized")
                except Exception as e:
                    print(f"[StellaLightAgent] Failed to get initial state: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print("[StellaLightAgent] No sm_client available")
        else:
            # Legacy mode
            if self.state_machine and self.state_machine.is_initialized and self.state_machine.execution_state:
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
            # Show processing status
            yield AgentOutput.status(
                input.session_id,
                "Processing your message...",
                StatusSubtype.PROCESSING
            )

            print(f"[StellaLightAgent] Processing: '{input.text}'")

            if self._use_tools:
                async for output in self._process_with_tools(input):
                    yield output
            else:
                async for output in self._process_legacy(input):
                    yield output

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

    async def _process_with_tools(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Process input using tool-based state management."""
        # Fetch conversation history
        conversation_history = await self._fetch_conversation_history(limit=self._history_limit)

        # Get state machine context from external service
        sm_context = {}
        if self.sm_client:
            try:
                # Parallelize all state machine calls for reduced latency
                # (~100-200ms sequential -> ~25-50ms parallel)
                state, tasks, deliverables, collected = await asyncio.gather(
                    self.sm_client.get_current_state(),
                    self.sm_client.get_pending_tasks(),
                    self.sm_client.get_pending_deliverables(),
                    self.sm_client.get_collected_deliverables()
                )

                print(f"[StellaLightAgent] get_current_state returned: {state}")
                if state:
                    sm_context = self._build_context_from_state(state)

                print(f"[StellaLightAgent] Pending tasks: {len(tasks)}, Pending deliverables: {len(deliverables)}, Collected: {len(collected)}")

                # Separate current tasks from preview tasks (for strict mode)
                current_tasks = [t for t in tasks if not t.get("is_preview")]
                preview_tasks = [t for t in tasks if t.get("is_preview")]

                sm_context["available_tasks"] = current_tasks  # Tasks to work on now
                sm_context["preview_tasks"] = preview_tasks   # Next tasks (for smooth transitions)

                # Include all deliverable fields for the prompt
                sm_context["deliverables"] = [
                    {
                        "key": d.get("key"),
                        "description": d.get("description"),
                        "type": d.get("type", "string"),
                        "required": d.get("required", True),
                        "status": "pending",
                        "acceptance_criteria": d.get("acceptance_criteria"),
                        "examples": d.get("examples"),
                        "enum_values": d.get("enum_values"),  # For enum types
                        "task_id": d.get("task_id"),
                    }
                    for d in deliverables
                ]

                # Add collected deliverables for update capability
                sm_context["collected_deliverables"] = collected

                # Set current_task to the first pending task (for prompt context)
                if current_tasks:
                    sm_context["current_task"] = current_tasks[0]
                    print(f"[StellaLightAgent] Current task: {current_tasks[0].get('description')}")
                    if current_tasks[0].get('instruction'):
                        print(f"[StellaLightAgent] Task instruction: {current_tasks[0].get('instruction')}")

                # Set next_task for strict mode transitions
                if preview_tasks:
                    sm_context["next_task"] = preview_tasks[0]
                    print(f"[StellaLightAgent] Next task (preview): {preview_tasks[0].get('description')}")

                print(f"[StellaLightAgent] sm_context keys: {list(sm_context.keys())}")

            except Exception as e:
                print(f"[StellaLightAgent] Failed to get state context: {e}")
                import traceback
                traceback.print_exc()
        else:
            print("[StellaLightAgent] WARNING: sm_client is None!")

        # Add custom system prompt from plan if available
        if self._plan_system_prompt:
            sm_context["plan_system_prompt"] = self._plan_system_prompt
            print(f"[StellaLightAgent] Using plan system prompt: {self._plan_system_prompt[:100]}...")

        # Inject configured prompts, resolving {{placeholder}} variables against
        # the live runtime context (same principle as stella-v2).
        self._inject_configured_prompts(sm_context, conversation_history, input.text)

        # Build prompts
        system_prompt = self.prompt_builder.build_system_prompt(sm_context)
        user_message = self.prompt_builder.build_user_message(
            user_input=input.text,
            conversation_history=conversation_history,
            context=sm_context
        )

        # Log prompt info for debugging
        print(f"[StellaLightAgent] System prompt length: {len(system_prompt)} chars")
        if "Information to Collect" in system_prompt:
            print("[StellaLightAgent] ✓ System prompt includes deliverable instructions")
        else:
            print("[StellaLightAgent] ✗ System prompt MISSING deliverable instructions!")

        # Process through ToolProcessor
        result: Optional[ToolProcessorResult] = None
        async for output in self.tool_processor.process(
            session_id=input.session_id,
            system_prompt=system_prompt,
            user_message=user_message
        ):
            if isinstance(output, ToolProcessorResult):
                result = output
            else:
                yield output

        # Handle results
        if result:
            # Emit deliverables
            for key in result.deliverables_set:
                # Get the actual value from the state machine
                try:
                    collected = await self.sm_client.get_collected_deliverables()
                    value = collected.get(key)
                    if value is not None:
                        yield AgentOutput.deliverable(input.session_id, key=key, value=value)
                except Exception as e:
                    print(f"[StellaLightAgent] Failed to get deliverable value: {e}")

            # Log tool usage
            if result.tool_calls_made:
                print(f"[StellaLightAgent] Tool calls: {[tc['name'] for tc in result.tool_calls_made]}")
            if result.deliverables_set:
                print(f"[StellaLightAgent] Deliverables set: {result.deliverables_set}")
            if result.tasks_completed:
                print(f"[StellaLightAgent] Tasks completed: {result.tasks_completed}")
            if result.transitioned:
                print(f"[StellaLightAgent] Transitioned to: {result.new_state_id}")

        # Increment turn counter if no progress was made
        if result and not result.deliverables_set and not result.tasks_completed:
            try:
                await self.sm_client.increment_turn()
            except Exception as e:
                print(f"[StellaLightAgent] Failed to increment turn: {e}")

        # Emit progress update with full state
        if self.sm_client:
            try:
                full_state = await self.sm_client.get_full_state()
                if full_state:
                    progress_state = self._build_progress_from_full_state(full_state)
                    yield AgentOutput.progress_update(
                        input.session_id,
                        progress_state,
                        update_trigger="turn_completion",
                        agent_name="stella-light-agent",
                        agent_icon="💡"
                    )
            except Exception as e:
                print(f"[StellaLightAgent] Failed to emit progress: {e}")

    async def _process_legacy(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Process input using legacy text-parsing state management."""
        # Fetch conversation history
        conversation_history = await self._fetch_conversation_history(limit=self._history_limit)

        # Get state machine context
        sm_context = {}
        if self.state_machine.is_initialized:
            sm_context = self.state_machine.get_context_for_prompt()

        # Add custom system prompt from plan if available
        if self._plan_system_prompt:
            sm_context["plan_system_prompt"] = self._plan_system_prompt

        # Inject configured prompts, resolving {{placeholder}} variables against
        # the live runtime context (same principle as stella-v2).
        self._inject_configured_prompts(sm_context, conversation_history, input.text)

        # Build prompts
        system_prompt = self.prompt_builder.build_system_prompt(sm_context)
        user_message = self.prompt_builder.build_user_message(
            user_input=input.text,
            conversation_history=conversation_history,
            context=sm_context
        )

        # Process through LightProcessor (streams response)
        result: Optional[ProcessorResult] = None
        async for output in self.legacy_processor.process(
            session_id=input.session_id,
            system_prompt=system_prompt,
            user_message=user_message
        ):
            if isinstance(output, ProcessorResult):
                result = output
            else:
                yield output

        # Handle deliverables
        if result and result.deliverables:
            print(f"[StellaLightAgent] Extracted deliverables: {list(result.deliverables.keys())}")

            if self.state_machine.is_initialized:
                sm_result = self.state_machine.process_deliverables(result.deliverables)
                if sm_result.should_advance and sm_result.next_state_id:
                    self.state_machine.advance_state()

            # Emit deliverables
            for key, data in result.deliverables.items():
                if isinstance(data, dict):
                    value = data.get("value")
                else:
                    value = data
                yield AgentOutput.deliverable(input.session_id, key=key, value=value)

        # Handle explicitly completed tasks
        if result and result.completed_tasks:
            print(f"[StellaLightAgent] Completed tasks: {result.completed_tasks}")

            if self.state_machine.is_initialized:
                marked = self.state_machine.mark_tasks_completed(result.completed_tasks)
                print(f"[StellaLightAgent] Marked tasks: {marked}")

                sm_result = self.state_machine.process_deliverables({})
                if sm_result.should_advance and sm_result.next_state_id:
                    self.state_machine.advance_state()

        # No progress - increment turn counter
        if result and not result.deliverables and not result.completed_tasks:
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

    def _build_context_from_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Build prompt context from external state machine state."""
        # Handle both 'state_title' (from gRPC) and 'title' (from direct dict)
        title = state.get("state_title") or state.get("title", "Unknown")
        state_type = state.get("state_type") or state.get("type", "loose")

        return {
            "processing_mode": state_type,
            "state": {
                "title": title,
                "description": state.get("description", ""),
            },
            "progress": {
                "percentage": state.get("progress", 0) * 100,
            },
            "state_just_changed": False,
        }

    def _build_progress_from_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Build progress state for frontend from external state machine state (legacy)."""
        return {
            "execution_mode": "progressive",
            "overall_progress": state.get("progress", 0),
            "groups": [],
            "metadata": {
                "started_at": self._session_started_at,
                "current_state": state.get("state_id"),
                "total_turns": state.get("total_turns", 0),
                "turns_without_progress": state.get("turns_without_progress", 0),
            }
        }

    def _build_progress_from_full_state(self, full_state: Dict[str, Any]) -> Dict[str, Any]:
        """Build progress state for frontend from full state machine state.

        The frontend expects ProgressUpdateMessage format:
        - groups[].label (not title)
        - groups[].items[] = flat deliverables with task info in metadata
        """
        import datetime

        groups = []
        current_group_id = None
        current_item_id = None

        for state in full_state.get("states", []):
            # Flatten: each deliverable becomes an item with task info in metadata
            items = []
            for task in state.get("tasks", []):
                for d in task.get("deliverables", []):
                    item = {
                        "id": d.get("key"),
                        "label": d.get("description"),
                        "status": d.get("status", "pending"),
                        "required": d.get("required", True),
                        "value": d.get("value"),
                        "confidence": d.get("confidence"),
                        "collected_at": d.get("collected_at"),
                        "metadata": {
                            "task_id": task.get("id"),
                            "task_description": task.get("description"),
                            "deliverable_type": d.get("type", "string"),
                            "acceptance_criteria": d.get("acceptance_criteria"),
                            "reasoning": d.get("reasoning"),
                        }
                    }
                    items.append(item)

                    # Track current item (first pending deliverable in active state)
                    if state.get("status") == "active" and d.get("status") == "pending" and not current_item_id:
                        current_item_id = d.get("key")

            # Map state status to group status
            group_status = state.get("status", "pending")
            if group_status == "active":
                group_status = "in_progress"

            group = {
                "id": state.get("id"),
                "label": state.get("title"),  # Frontend expects 'label' not 'title'
                "execution_mode": state.get("type", "loose"),
                "status": group_status,
                "items": items,
                "is_current": state.get("status") == "active",
                "description": state.get("description"),
                "completed_at": None,
                "metadata": {},
            }
            groups.append(group)

            # Track current group
            if state.get("status") == "active":
                current_group_id = state.get("id")

        return {
            "groups": groups,
            "current_group_id": current_group_id,
            "current_item_id": current_item_id,
            "progress_percentage": full_state.get("progress", 0),
            "elapsed_minutes": 0,
            "started_at": self._session_started_at,
            "last_updated": datetime.datetime.now().isoformat(),
            "metadata": {
                "plan_id": full_state.get("plan_id"),
                "plan_title": full_state.get("plan_title"),
                "current_state_id": full_state.get("current_state_id"),
                "total_turns": full_state.get("total_turns", 0),
                "turns_without_progress": full_state.get("turns_without_progress", 0),
            }
        }

    async def on_interrupt(self, session_id: str) -> None:
        """Handle user interruption (barge-in)."""
        print(f"[StellaLightAgent] Interrupt received: {session_id}")
        if self._use_tools and self.tool_processor:
            self.tool_processor.cancel()
        elif self.legacy_processor:
            self.legacy_processor.cancel()
        self._is_processing = False

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """Handle runtime configuration updates."""
        print(f"[StellaLightAgent] Config update: {list(config.keys())}")
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
            "mode": "tool-based" if self._use_tools else "legacy",
            "llm_stats": self.llm_service.get_usage_stats(),
        }

        if self._use_tools and self.sm_client:
            try:
                state = await self.sm_client.get_current_state()
                deliverables = await self.sm_client.get_collected_deliverables()
                summary["deliverables"] = deliverables
                summary["progress"] = state.get("progress", 0) if state else 0
            except Exception as e:
                print(f"[StellaLightAgent] Failed to get session summary: {e}")

            # Disconnect state machine client
            await self.sm_client.disconnect()
            self.sm_client = None
            self.tool_registry = None
            self.tool_processor = None

        elif self.state_machine and self.state_machine.is_initialized and self.state_machine.execution_state:
            summary["deliverables"] = self.state_machine.execution_state.get_all_deliverable_values()
            summary["progress"] = self.state_machine.execution_state.calculate_progress()
            summary["state_machine"] = self.state_machine.get_status_summary()
            self.state_machine = StateMachine()

        # Reset for next session
        self.llm_service.reset_stats()
        self._session_started_at = None

        return summary

    async def _fetch_conversation_history(self, limit: int = 20) -> List[Dict[str, str]]:
        """Fetch conversation history from the SDK."""
        try:
            history = await self.get_chat_history()
            if history:
                return [
                    {"role": msg.role, "content": msg.content}
                    for msg in history[-limit:]
                ]
        except Exception as e:
            print(f"[StellaLightAgent] Failed to fetch history: {e}")

        return []
