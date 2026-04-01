"""STELLA V2 Agent — streamlined 4-stage pipeline with deterministic arbitration.

Processing Flow:
1. Input Gate — fast JSON classification (~100-200ms)
2. Expert Pool — parallel structured verdicts (~150-300ms wall-clock)
3. Deterministic Arbitration — priority-based conflict resolution (~1ms, no LLM)
4. Response Generator — streaming final answer with arbitration context

Key differences from V1:
- No SAFE/UNSAFE distinction: every input flows through all 4 stages
- Input Gate returns structured JSON, selects which experts to run
- Experts return short structured verdicts (not free-form text)
- Arbitration is deterministic code (not an LLM call)
- Expert configs are loadable from outside (like plans)
- On Input Gate failure: predefined error message, no fallback generation
"""

import asyncio
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype
from stella_agent_sdk.services.state_machine_client import StateMachineClient
from stella_agent_sdk.tools import ToolRegistry
from stella_agent_sdk.tools.state_machine import create_state_machine_tools

from stella_v2_agent.llm.service import LLMService
from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.pipeline.input_gate import InputGate
from stella_v2_agent.pipeline.bridge_generator import BridgeGenerator
from stella_v2_agent.pipeline.expert_pool import ExpertPool
from stella_v2_agent.pipeline.arbitration import Arbitration, _DEFAULT_GATE_FAILURE_MESSAGE
from stella_v2_agent.pipeline.response_generator import ResponseGenerator
from stella_v2_agent.adapters import ProgressAdapter
import logging

logger = logging.getLogger(__name__)


class StellaV2Agent(BaseAgent):
    """STELLA V2 Agent: 4-stage pipeline with deterministic arbitration.

    Pipeline stages:
    1. InputGate — classify input, select experts
    2. ExpertPool — run experts in parallel
    3. Arbitration — deterministic conflict resolution
    4. ResponseGenerator — streaming response with injected guidance

    Post-response:
    - Process task_extraction deliverables through state machine
    - Handle state transitions
    - Emit progress updates
    """

    def __init__(
        self,
        llm_config_path: Optional[str] = None,
        experts_dir: Optional[str] = None,
        state_machine_address: Optional[str] = None,
    ):
        """Initialize the STELLA V2 Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file.
            experts_dir: Path to directory containing expert JSON configs.
            state_machine_address: gRPC address for state machine service.
        """
        super().__init__()

        self._agent_type = "stella-v2-agent"

        # Resolve config paths
        if llm_config_path is None:
            llm_config_path = self._find_config_file("config/llm_config.json")

        # State machine gRPC address
        self._state_machine_address = (
            state_machine_address
            or os.environ.get("STATE_MACHINE_ADDRESS", "localhost:50051")
        )

        # Initialize core services
        self.llm_service = LLMService(config_path=llm_config_path)
        self.expert_registry = ExpertRegistry(experts_dir=experts_dir)

        # Initialize pipeline stages
        self.input_gate = InputGate(self.llm_service, self.expert_registry)
        self.bridge_generator = BridgeGenerator(self.llm_service)
        self.expert_pool = ExpertPool(self.llm_service, self.expert_registry)
        self.arbitration = Arbitration()
        self.response_generator = ResponseGenerator(self.llm_service)

        # gRPC state machine client (initialized per session)
        self.sm_client: Optional[StateMachineClient] = None
        self.tool_registry: Optional[ToolRegistry] = None

        # Session state
        self.config: Dict[str, Any] = {}
        self._session_started_at: Optional[str] = None
        self._plan_system_prompt: Optional[str] = None
        self._plan_config: Optional[Dict[str, Any]] = None  # stored for context building
        self._custom_history_limit: int = 20  # overridable via pipeline_config thresholds

        logger.info(
            f"Initialized with {self.expert_registry.enabled_count} experts"
        )

    # ─────────────────────────────────────────────────────────────────────
    # Main processing pipeline
    # ─────────────────────────────────────────────────────────────────────

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Process user input through the 4-stage pipeline.

        Yields AgentOutput messages: status updates, text chunks, debug info,
        deliverables, progress updates.
        """
        self._is_processing = True

        try:
            # Fetch context
            history_limit = self._custom_history_limit
            history = await self._fetch_conversation_history(limit=history_limit)

            # Fetch state from gRPC backend (parallel calls for performance)
            sm_context = {}
            if self.sm_client:
                sm_context = await self._fetch_sm_context()
            if self._plan_system_prompt:
                sm_context["plan_system_prompt"] = self._plan_system_prompt

            yield AgentOutput.status(
                input.session_id, "Processing your message...", StatusSubtype.PROCESSING
            )

            # ── Stage 1: Input Gate + Bridge Generator (parallel) ──
            logger.info(f"Stage 1: Input Gate + Bridge for: '{input.text}'")
            gate_result, bridge = await asyncio.gather(
                self.input_gate.classify(input.text, history, sm_context),
                self.bridge_generator.generate(input.text, history),
            )

            yield AgentOutput.debug(
                input.session_id,
                f"InputGate: selected {len(gate_result.experts)} experts in {gate_result.latency_ms:.0f}ms",
                component="input_gate",
                **gate_result.to_debug_dict(),
            )

            # On gate failure: ignore bridge, send hardcoded message, skip all downstream stages
            if gate_result.failed:
                yield AgentOutput.text_chunk(
                    input.session_id, _DEFAULT_GATE_FAILURE_MESSAGE, is_final=True
                )
                return

            # Generate a shared transcript_id so bridge and response share it
            transcript_id = f"response_{uuid.uuid4().hex[:8]}"

            # Emit bridge immediately for early TTS synthesis
            if bridge:
                logger.info(f"Bridge: '{bridge}'")
                yield AgentOutput.text_chunk(
                    input.session_id,
                    bridge,
                    transcript_id=transcript_id,
                    is_final=False,
                )

            # ── Stage 2: Expert Pool (foreground + background) ──
            # Foreground experts (probing, safety, etc.) block until done — needed for arbitration.
            # Background experts (task_extraction) launch concurrently, collected after response.

            experts_to_run = list(gate_result.experts)

            logger.info(f"Stage 2: Expert Pool — {experts_to_run}")
            fg_verdicts, bg_task = await self.expert_pool.run_foreground(
                experts_to_run, input.text, history, sm_context
            )

            for v in fg_verdicts:
                yield AgentOutput.debug(
                    input.session_id,
                    f"Expert '{v.expert_name}': {v.verdict} ({v.confidence:.2f}) in {v.latency_ms:.0f}ms",
                    component=f"expert:{v.expert_name}",
                    **v.to_debug_dict(),
                )

            # ── Stage 3: Deterministic Arbitration (foreground verdicts only) ──
            logger.info("Stage 3: Arbitration")
            arb_result = self.arbitration.resolve(fg_verdicts)

            yield AgentOutput.debug(
                input.session_id,
                f"Arbitration: tone={arb_result.directive.tone}, favored={arb_result.favored_expert}",
                component="arbitration",
                **arb_result.to_debug_dict(),
            )

            # Emit deliverable signals as a dedicated debug message
            if arb_result.directive.deliverable_signals:
                signals = arb_result.directive.deliverable_signals
                yield AgentOutput.debug(
                    input.session_id,
                    f"Deliverable signals detected: {', '.join(signals)}",
                    component="deliverable_signals",
                    stage="pre_response",
                    signals=signals,
                    source="probing",
                    note="Response will acknowledge these. Validated extraction runs in background.",
                )

            # Short-circuit: noise_detection override (ask user to repeat)
            if arb_result.directive.short_circuit:
                # Cancel background task — not needed
                if bg_task:
                    bg_task.cancel()
                yield AgentOutput.text_chunk(
                    input.session_id,
                    arb_result.directive.redirect_message or _DEFAULT_GATE_FAILURE_MESSAGE,
                    is_final=True,
                )
                return

            # ── Stage 4: Response + Background Extraction (concurrent) ──
            # Response streams to user while task_extraction finishes in background.
            # As soon as extraction completes, deliverables and progress updates
            # are emitted immediately — the frontend todo list updates in real-time.
            logger.info("Stage 4: Response Generator (streaming)")
            yield AgentOutput.status(
                input.session_id, "Generating response...", StatusSubtype.PROCESSING
            )

            pre_signals = arb_result.directive.deliverable_signals
            bg_queue: asyncio.Queue = asyncio.Queue()

            # Background task: collect extraction results → process → push to queue
            async def _bg_extract_and_process():
                try:
                    bg_verdicts = await self.expert_pool.collect_background(bg_task)

                    # Debug: emit each background verdict
                    for v in bg_verdicts:
                        await bg_queue.put(AgentOutput.debug(
                            input.session_id,
                            f"Expert '{v.expert_name}': {v.verdict} ({v.confidence:.2f}) in {v.latency_ms:.0f}ms",
                            component=f"expert:{v.expert_name}",
                            **v.to_debug_dict(),
                        ))

                    # Debug: validation — compare probing signals vs tool extraction
                    task_v = next(
                        (v for v in bg_verdicts if v.expert_name == "task_extraction" and v.success),
                        None,
                    )
                    extracted_keys = task_v.raw_output.get("deliverables_set", []) if task_v and task_v.raw_output else []
                    if pre_signals or extracted_keys:
                        await bg_queue.put(AgentOutput.debug(
                            input.session_id,
                            f"Extraction validation: signals={pre_signals}, extracted={extracted_keys}",
                            component="deliverable_validation",
                            stage="post_response",
                            probing_signals=pre_signals,
                            extraction_result=extracted_keys,
                            match=set(pre_signals) == set(extracted_keys) if pre_signals else None,
                        ))

                    # Process deliverables → state machine updates → emit immediately
                    all_verdicts = fg_verdicts + bg_verdicts
                    async for output in self._process_post_response(
                        input.session_id, all_verdicts, gate_result
                    ):
                        await bg_queue.put(output)

                except Exception as e:
                    logger.error(f"Background extraction error: {e}")
                    await bg_queue.put(AgentOutput.debug(
                        input.session_id,
                        f"Background extraction error: {str(e)[:200]}",
                        component="bg_extraction",
                        level="error",
                    ))
                finally:
                    await bg_queue.put(None)  # sentinel: bg is done

            bg_processing = asyncio.create_task(_bg_extract_and_process())

            # Stream response tokens, interleaving background outputs as they arrive
            bg_done = False
            async for output in self.response_generator.generate(
                session_id=input.session_id,
                user_input=input.text,
                directive=arb_result.directive,
                conversation_history=history,
                sm_context=sm_context,
                plan_system_prompt=self._plan_system_prompt,
                bridge=bridge,
                transcript_id=transcript_id,
            ):
                yield output
                # Drain any background outputs that arrived while streaming
                while not bg_queue.empty():
                    bg_output = bg_queue.get_nowait()
                    if bg_output is None:
                        bg_done = True
                        break
                    yield bg_output

            # Response done — drain remaining background outputs (skip if sentinel already consumed)
            if not bg_done:
                while True:
                    bg_output = await bg_queue.get()
                    if bg_output is None:
                        break
                    yield bg_output

        except Exception as e:
            logger.error(f"Processing error: {e}")
            yield AgentOutput.error(
                input.session_id,
                f"Processing error: {str(e)}",
                error_type="processing_error",
                recoverable=True,
            )

        finally:
            self._is_processing = False

    # ─────────────────────────────────────────────────────────────────────
    # Post-response processing
    # ─────────────────────────────────────────────────────────────────────

    async def _process_post_response(
        self,
        session_id: str,
        expert_verdicts: list,
        gate_result,
    ) -> AsyncIterator[AgentOutput]:
        """Process expert results after response generation completes.

        With tool calling, task_extraction updates the backend state machine
        directly via set_deliverable/complete_task tools. We just need to:
        1. Read what tools did from the verdict
        2. Emit AgentOutput.deliverable() for each set deliverable
        3. Increment turn counter if no progress
        4. Fetch updated full state and emit progress
        """
        if not self.sm_client:
            return

        deliverables_found = False
        tasks_completed = False

        # Process task_extraction verdict (tool-based)
        task_verdict = next(
            (v for v in expert_verdicts if v.expert_name == "task_extraction" and v.success),
            None,
        )
        if task_verdict and task_verdict.raw_output:
            raw = task_verdict.raw_output

            # Session termination: backend transitioned to __end__.
            # Emit the farewell before the progress update, then flag the agent
            # to stop accepting new turns (run_audio_loop checks _session_completed).
            if raw.get("session_completed"):
                farewell = raw.get("farewell_message")
                if farewell:
                    yield AgentOutput.text_final(session_id, farewell)
                self._session_completed = True
                logger.info(
                    f"Session {session_id} completed — agent will exit after this turn"
                )
                # Fall through so the final progress update is still emitted.

            deliverables_set = raw.get("deliverables_set", [])
            tasks_done = raw.get("tasks_completed", [])

            if deliverables_set:
                deliverables_found = True
                # Fetch collected values from backend to emit accurate data
                collected = await self.sm_client.get_collected_deliverables()

                yield AgentOutput.debug(
                    session_id,
                    f"Tool extraction: {len(deliverables_set)} deliverables set",
                    component="post_response",
                    deliverable_keys=deliverables_set,
                )

                for key in deliverables_set:
                    value = collected.get(key)
                    yield AgentOutput.deliverable(session_id, key=key, value=value)

            if tasks_done:
                tasks_completed = True
                yield AgentOutput.debug(
                    session_id,
                    f"Completed tasks: {tasks_done}",
                    component="post_response",
                    completed_task_ids=tasks_done,
                )

        # Increment turn counter if no progress was made
        if not deliverables_found and not tasks_completed:
            await self.sm_client.increment_turn()

        # Fetch updated full state and emit progress
        full_state = await self.sm_client.get_full_state()
        if full_state:
            progress_state = ProgressAdapter.from_full_state_dict(
                full_state, started_at=self._session_started_at
            )
            yield AgentOutput.progress_update(
                session_id,
                progress_state,
                update_trigger="turn_completion",
                agent_name=self.agent_name,
                agent_icon="🧠",
            )

    # ─────────────────────────────────────────────────────────────────────
    # Session lifecycle
    # ─────────────────────────────────────────────────────────────────────

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """Initialize session: load plan, configure experts, set up state machine."""
        await super().on_session_start(session_id, config)

        self._session_started_at = datetime.utcnow().isoformat() + "Z"
        self.config = config
        self._plan_system_prompt = None
        self._plan_config = None

        # Load plan and initialize gRPC state machine
        plan = self._load_plan_config(config)
        if plan:
            self._plan_config = plan

            # Connect to gRPC state machine service
            self.sm_client = StateMachineClient(
                session_id=session_id,
                address=self._state_machine_address,
            )
            await self.sm_client.connect()
            result = await self.sm_client.initialize(plan)

            if result and result.get("success"):
                logger.info(f"State machine initialized via gRPC: {plan.get('title', 'Unknown')}")
            else:
                error = result.get("error", "unknown") if result else "no response"
                logger.error(f"Failed to initialize state machine: {error}")

            # Create tool registry with SDK state machine tools
            self.tool_registry = ToolRegistry()
            for tool in create_state_machine_tools(self.sm_client):
                self.tool_registry.register(tool)

            # Wire tool registry into expert pool
            self.expert_pool.set_tool_registry(self.tool_registry)

            if "system_prompt" in plan:
                self._plan_system_prompt = plan["system_prompt"]

        # Apply per-session expert overrides from config
        expert_overrides = config.get("expert_overrides", {})
        if expert_overrides:
            experts_dir = config.get("experts_dir")
            self.expert_registry = ExpertRegistry(
                experts_dir=experts_dir, overrides=expert_overrides
            )
            # Rebuild pipeline stages with updated registry
            self.input_gate = InputGate(self.llm_service, self.expert_registry)
            self.expert_pool = ExpertPool(
                self.llm_service, self.expert_registry,
                tool_registry=self.tool_registry,
            )

        # Apply LLM config overrides
        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        # Apply pipeline configuration (from Agent Configurator) — required
        pipeline_config = config.get("pipeline_config")
        if not pipeline_config:
            raise ValueError(
                "pipeline_config is required. Please select or create a pipeline "
                "configuration before deploying the agent."
            )
        self._apply_pipeline_config(pipeline_config)

        logger.info(f"Session started: {session_id}")

    async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
        """Send initial progress state when agent joins the room."""
        if self.sm_client:
            full_state = await self.sm_client.get_full_state()
            if full_state:
                progress_state = ProgressAdapter.from_full_state_dict(
                    full_state, started_at=self._session_started_at,
                )
                yield AgentOutput.progress_update(
                    session_id,
                    progress_state,
                    update_trigger="session_start",
                    agent_name=self.agent_name,
                    agent_icon="🧠",
                )

    def _apply_pipeline_config(self, pipeline_config: Dict[str, Any]) -> None:
        """Apply pipeline configuration overrides from Agent Configurator.

        Reads 'nodes' and 'thresholds' from the config dict and calls
        apply_config() on each pipeline stage.
        """
        nodes = pipeline_config.get("nodes", {})
        thresholds = pipeline_config.get("thresholds", {})

        # Apply per-node config overrides
        node_stage_map = {
            "input_gate": self.input_gate,
            "expert_pool": self.expert_pool,
            "arbitration": self.arbitration,
            "response_generator": self.response_generator,
            "bridge_generator": self.bridge_generator,
        }

        for node_id, node_config in nodes.items():
            stage = node_stage_map.get(node_id)
            if stage and isinstance(node_config, dict) and hasattr(stage, "apply_config"):
                stage.apply_config(node_config)
                logger.info(f"Applied config to {node_id}")

        # Apply expert registry config (experts and custom_experts are in expert_pool node)
        expert_pool_config = nodes.get("expert_pool", {})
        if isinstance(expert_pool_config, dict):
            experts_config = {
                k: v for k, v in expert_pool_config.items()
                if k in ("experts", "custom_experts")
            }
            if experts_config:
                self.expert_registry.apply_config(experts_config)
                # Rebuild input gate with updated registry summaries
                # (no need to rebuild objects — registry is shared by reference)

        # Apply threshold overrides
        if "history_limit" in thresholds:
            self._custom_history_limit = int(thresholds["history_limit"])

        logger.info(f"Pipeline config applied: {len(nodes)} nodes, {len(thresholds)} thresholds")

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """Cleanup and return session summary."""
        result = await super().on_session_end(session_id)

        summary: Dict[str, Any] = {
            "agent": "stella-v2-agent",
            "llm_stats": self.llm_service.get_usage_stats(),
            **result,
        }

        if self.sm_client:
            full_state = await self.sm_client.get_full_state()
            if full_state:
                summary["state_machine"] = {
                    "plan_id": full_state.get("plan_id"),
                    "plan_title": full_state.get("plan_title"),
                    "final_state": full_state.get("current_state_id"),
                    "progress_percentage": full_state.get("progress", 0) * 100,
                    "collected_deliverables": full_state.get("collected_deliverables", {}),
                }
            await self.sm_client.disconnect()
            self.sm_client = None
            self.tool_registry = None

        self.config = {}
        self._plan_config = None
        logger.info(f"Session ended: {session_id}")
        return summary

    async def on_interrupt(self, session_id: str) -> None:
        """Handle user interrupt (barge-in)."""
        logger.info(f"Interrupt received: {session_id}")
        self._is_processing = False

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """Handle runtime configuration update."""
        await super().on_config_update(session_id, config)
        self.config.update(config)

        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        logger.info(f"Config updated: {list(config.keys())}")

    # ─────────────────────────────────────────────────────────────────────
    # Helper methods
    # ─────────────────────────────────────────────────────────────────────

    def _load_plan_config(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Load plan configuration from config or disk."""
        if "plan_id" in config:
            plan = self._load_plan(config["plan_id"])
            if plan:
                logger.info(f"Loaded plan '{config['plan_id']}' from disk")
                return plan
            logger.error(f"Failed to load plan '{config['plan_id']}'")

        elif "plan" in config:
            logger.info("Using direct plan from config")
            return config["plan"]

        return None

    def _load_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        """Load a plan from disk by plan ID."""
        candidates: List[Path] = []

        env_dir = os.environ.get("STELLA_PLANS_DIR")
        if env_dir:
            candidates.append(Path(env_dir))

        candidates.append(Path("/app/stella-v2-agent/config/plans"))

        package_dir = Path(__file__).parent
        candidates.append(package_dir.parent.parent / "config" / "plans")

        for plans_dir in candidates:
            if not plans_dir.exists() or not plans_dir.is_dir():
                continue
            plan_file = plans_dir / f"{plan_id}.json"
            if plan_file.exists():
                try:
                    with open(plan_file, "r", encoding="utf-8") as f:
                        plan = json.load(f)
                    logger.info(f"Loaded plan from {plan_file}")
                    return plan
                except (json.JSONDecodeError, OSError) as e:
                    logger.error(f"Failed to load plan {plan_file}: {e}")

        logger.warning(f"Plan '{plan_id}' not found")
        return None

    def _find_config_file(self, relative_path: str) -> Optional[str]:
        """Find a config file by trying multiple locations."""
        candidates = [
            Path(f"/app/stella-v2-agent/{relative_path}"),
            Path(__file__).parent.parent.parent / relative_path,
            Path(relative_path),
        ]
        for path in candidates:
            if path.exists():
                return str(path)
        return None

    async def _fetch_sm_context(self) -> Dict[str, Any]:
        """Fetch state from gRPC backend and build sm_context for the pipeline.

        Makes parallel gRPC calls, then assembles the dict structure that the
        template compiler's {{placeholders}} expect. Mirrors the shape of the
        old local StateMachine.get_context_for_prompt() / get_full_plan_context().
        """
        if not self.sm_client:
            return {}

        full_state, current_state, pending_tasks, pending_deliverables, collected = (
            await asyncio.gather(
                self.sm_client.get_full_state(),
                self.sm_client.get_current_state(),
                self.sm_client.get_pending_tasks(),
                self.sm_client.get_pending_deliverables(),
                self.sm_client.get_collected_deliverables(),
            )
        )

        if not full_state or not current_state:
            return {}

        current_state_id = full_state.get("current_state_id")

        # Build state description lookup from stored plan config
        state_descriptions: Dict[str, str] = {}
        if self._plan_config:
            for s in self._plan_config.get("states", []):
                state_descriptions[s.get("id", "")] = s.get("description", "")

        # Examples lookup from pending_deliverables (not in full_state)
        examples_map: Dict[str, list] = {
            d["key"]: d.get("examples", []) for d in pending_deliverables
        }

        # Build full_plan from full_state (for {{plan}} and {{current_focus}})
        full_plan: List[Dict[str, Any]] = []
        for state in full_state.get("states", []):
            state_entry: Dict[str, Any] = {
                "id": state.get("id"),
                "title": state.get("title"),
                "is_current": state.get("id") == current_state_id,
                "tasks": [],
            }
            for task in state.get("tasks", []):
                task_entry: Dict[str, Any] = {
                    "id": task.get("id"),
                    "description": task.get("description"),
                    "instruction": task.get("instruction", ""),
                    "status": task.get("status", "pending"),
                    "has_deliverables": len(task.get("deliverables", [])) > 0,
                    "deliverables": [],
                }
                for d in task.get("deliverables", []):
                    task_entry["deliverables"].append({
                        "key": d.get("key"),
                        "description": d.get("description"),
                        "type": d.get("type", "string"),
                        "required": d.get("required", True),
                        "status": d.get("status", "pending"),
                        "value": d.get("value"),
                        "acceptance_criteria": d.get("acceptance_criteria"),
                        "examples": examples_map.get(d.get("key", ""), []),
                    })
                state_entry["tasks"].append(task_entry)
            full_plan.append(state_entry)

        # Build deliverables list (pending with full detail + completed summary)
        deliverables_list: List[Dict[str, Any]] = [
            {
                "key": d.get("key"),
                "description": d.get("description"),
                "type": d.get("type", "string"),
                "required": d.get("required", True),
                "status": "pending",
                "acceptance_criteria": d.get("acceptance_criteria"),
                "examples": d.get("examples", []),
            }
            for d in pending_deliverables
        ]
        for key, value in collected.items():
            deliverables_list.append({
                "key": key,
                "status": "completed",
                "value": value,
            })

        # Current task from pending_tasks (exclude previews)
        current_tasks = [t for t in pending_tasks if not t.get("is_preview")]
        current_task = current_tasks[0] if current_tasks else None

        state_type = current_state.get("state_type", "loose")

        return {
            "full_plan": full_plan,
            "state": {
                "id": current_state.get("state_id"),
                "title": current_state.get("state_title"),
                "type": state_type,
                "description": state_descriptions.get(
                    current_state.get("state_id", ""), ""
                ),
                "goal_objective": current_state.get("goal_objective"),
                "goal_context": current_state.get("goal_context"),
                "goal_depth_guidance": current_state.get("goal_depth_guidance"),
                "goal_boundaries": current_state.get("goal_boundaries"),
                "goal_success_description": current_state.get("goal_success_description"),
            },
            "processing_mode": state_type,
            "available_tasks": current_tasks,
            "current_task": current_task,
            "deliverables": deliverables_list,
            "progress": {
                "percentage": current_state.get("progress", 0) * 100,
                "turns_without_deliverable": current_state.get(
                    "turns_without_progress", 0
                ),
            },
            "state_just_changed": False,
            "collected_deliverables": collected,
        }

    async def _fetch_conversation_history(self, limit: int = 20) -> List[Dict[str, str]]:
        """Fetch conversation history from database via SDK."""
        if not self.has_history:
            return []
        try:
            messages = await self.get_chat_history(include_debug=False, limit=limit)
            history = []
            for msg in messages:
                role = "user" if msg.role == "user" else "assistant"
                if msg.content.strip():
                    history.append({"role": role, "content": msg.content})
            return history
        except Exception as e:
            logger.error(f"Failed to fetch history: {e}")
            return []
