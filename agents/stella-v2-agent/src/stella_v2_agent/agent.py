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

from stella_v2_agent.llm.service import LLMService
from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.pipeline.input_gate import InputGate
from stella_v2_agent.pipeline.bridge_generator import BridgeGenerator
from stella_v2_agent.pipeline.expert_pool import ExpertPool
from stella_v2_agent.pipeline.arbitration import Arbitration
from stella_v2_agent.pipeline.response_generator import ResponseGenerator
from stella_v2_agent.state_machine import StateMachine
from stella_v2_agent.adapters import ProgressAdapter

# Hardcoded fallback message when Input Gate fails
_GATE_FAILURE_MESSAGE = "I'm sorry, I didn't quite catch that. Could you say that again?"


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
    ):
        """Initialize the STELLA V2 Agent.

        Args:
            llm_config_path: Path to LLM configuration JSON file.
            experts_dir: Path to directory containing expert JSON configs.
        """
        super().__init__()

        self._agent_type = "stella-v2-agent"

        # Resolve config paths
        if llm_config_path is None:
            llm_config_path = self._find_config_file("config/llm_config.json")

        # Initialize core services
        self.llm_service = LLMService(config_path=llm_config_path)
        self.expert_registry = ExpertRegistry(experts_dir=experts_dir)

        # Initialize pipeline stages
        self.input_gate = InputGate(self.llm_service, self.expert_registry)
        self.bridge_generator = BridgeGenerator(self.llm_service)
        self.expert_pool = ExpertPool(self.llm_service, self.expert_registry)
        self.arbitration = Arbitration()
        self.response_generator = ResponseGenerator(self.llm_service)

        # State machine (initialized per session)
        self.state_machine = StateMachine()
        self.timekeeper_threshold = 2

        # Session state
        self.config: Dict[str, Any] = {}
        self._session_started_at: Optional[str] = None
        self._plan_system_prompt: Optional[str] = None

        print(
            f"[StellaV2Agent] Initialized with {self.expert_registry.enabled_count} experts"
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
            history = await self._fetch_conversation_history(limit=20)
            sm_context = (
                self.state_machine.get_context_for_prompt()
                if self.state_machine.is_initialized
                else {}
            )
            if self.state_machine.is_initialized:
                sm_context["full_plan"] = self.state_machine.get_full_plan_context()
            if self._plan_system_prompt:
                sm_context["plan_system_prompt"] = self._plan_system_prompt

            yield AgentOutput.status(
                input.session_id, "Processing your message...", StatusSubtype.PROCESSING
            )

            # ── Stage 1: Input Gate + Bridge Generator (parallel) ──
            print(f"[StellaV2Agent] Stage 1: Input Gate + Bridge for: '{input.text}'")
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
                    input.session_id, _GATE_FAILURE_MESSAGE, is_final=True
                )
                return

            # Generate a shared transcript_id so bridge and response share it
            transcript_id = f"response_{uuid.uuid4().hex[:8]}"

            # Emit bridge immediately for early TTS synthesis
            if bridge:
                print(f"[StellaV2Agent] Bridge: '{bridge}'")
                yield AgentOutput.text_chunk(
                    input.session_id,
                    bridge,
                    transcript_id=transcript_id,
                    is_final=False,
                )

            # ── Stage 2: Expert Pool (foreground + background) ──
            # Foreground experts (probing, safety, etc.) block until done — needed for arbitration.
            # Background experts (task_extraction) launch concurrently, collected after response.
            print(f"[StellaV2Agent] Stage 2: Expert Pool — {gate_result.experts}")
            fg_verdicts, bg_task = await self.expert_pool.run_foreground(
                gate_result.experts, input.text, history, sm_context
            )

            for v in fg_verdicts:
                yield AgentOutput.debug(
                    input.session_id,
                    f"Expert '{v.expert_name}': {v.verdict} ({v.confidence:.2f}) in {v.latency_ms:.0f}ms",
                    component=f"expert:{v.expert_name}",
                    **v.to_debug_dict(),
                )

            # ── Stage 3: Deterministic Arbitration (foreground verdicts only) ──
            print(f"[StellaV2Agent] Stage 3: Arbitration")
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
                    arb_result.directive.redirect_message or _GATE_FAILURE_MESSAGE,
                    is_final=True,
                )
                return

            # ── Stage 4: Response + Background Extraction (concurrent) ──
            # Response streams to user while task_extraction finishes in background.
            # As soon as extraction completes, deliverables and progress updates
            # are emitted immediately — the frontend todo list updates in real-time.
            print(f"[StellaV2Agent] Stage 4: Response Generator (streaming)")
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

                    # Debug: validation — compare probing signals vs extraction
                    task_v = next(
                        (v for v in bg_verdicts if v.expert_name == "task_extraction" and v.success),
                        None,
                    )
                    extracted_keys = list(task_v.raw_output.get("deliverables", {}).keys()) if task_v else []
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
                    print(f"[StellaV2Agent] Background extraction error: {e}")
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
            print(f"[StellaV2Agent] Processing error: {e}")
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

        Handles:
        - task_extraction deliverables → state machine updates
        - Completed tasks → state machine mark_tasks_completed
        - Timekeeper suggestions → apply deliverables / force transitions
        - State transitions
        - Progress updates
        """
        if not self.state_machine.is_initialized:
            return

        deliverables_found = False
        tasks_completed = False

        # Process task_extraction verdict
        task_verdict = next(
            (v for v in expert_verdicts if v.expert_name == "task_extraction" and v.success),
            None,
        )
        if task_verdict and task_verdict.raw_output:
            raw = task_verdict.raw_output

            # Extract deliverables — trust the background expert but filter obvious junk
            raw_deliverables = raw.get("deliverables", {})
            min_confidence = 0.7
            extracted_deliverables = {}
            rejected_deliverables = {}

            for key, data in raw_deliverables.items():
                if isinstance(data, dict):
                    confidence = float(data.get("confidence", 0.0))
                    if confidence < min_confidence:
                        rejected_deliverables[key] = {
                            "reason": f"confidence {confidence:.2f} < {min_confidence}",
                            "value": data.get("value"),
                        }
                        continue
                extracted_deliverables[key] = data

            if rejected_deliverables:
                yield AgentOutput.debug(
                    session_id,
                    f"Rejected {len(rejected_deliverables)} low-confidence deliverables: {list(rejected_deliverables.keys())}",
                    component="post_response",
                    rejected=rejected_deliverables,
                    threshold=min_confidence,
                )

            if extracted_deliverables:
                deliverables_found = True
                yield AgentOutput.debug(
                    session_id,
                    f"Accepted {len(extracted_deliverables)} deliverables",
                    component="post_response",
                    deliverable_keys=list(extracted_deliverables.keys()),
                )

                result = self.state_machine.process_deliverables(extracted_deliverables)

                # Emit deliverables via SDK
                for key, data in extracted_deliverables.items():
                    value = data.get("value", data) if isinstance(data, dict) else data
                    yield AgentOutput.deliverable(session_id, key=key, value=value)

                # Handle state transition
                if result.should_advance and result.next_state_id:
                    transition_output = self._handle_state_transition(session_id, result.transition_reason)
                    if transition_output:
                        yield transition_output

            # Mark explicitly completed tasks
            completed_task_ids = raw.get("completed_tasks", [])
            if completed_task_ids:
                tasks_completed = True
                marked = self.state_machine.mark_tasks_completed(completed_task_ids)

                yield AgentOutput.debug(
                    session_id,
                    f"Completed tasks: {marked}",
                    component="post_response",
                    completed_task_ids=marked,
                )

                # Check for state transitions after marking tasks
                result = self.state_machine.process_deliverables({})
                if result.should_advance and result.next_state_id:
                    transition_output = self._handle_state_transition(
                        session_id, "explicit_task_completion"
                    )
                    if transition_output:
                        yield transition_output

            # Handle state transition from task_extraction
            state_transition = raw.get("state_transition")
            if state_transition:
                self.state_machine.force_transition(state_transition)

        # Process timekeeper verdict (apply suggested deliverables, force transitions)
        timekeeper_verdict = next(
            (v for v in expert_verdicts if v.expert_name == "timekeeper" and v.success),
            None,
        )
        if timekeeper_verdict and timekeeper_verdict.raw_output:
            raw = timekeeper_verdict.raw_output
            suggested = raw.get("suggested_deliverables", {})
            if suggested:
                applied = self.state_machine.apply_timekeeper_deliverables(suggested)
                if applied:
                    deliverables_found = True
                    for key in applied:
                        yield AgentOutput.deliverable(
                            session_id, key=key, value=suggested[key]
                        )

            if raw.get("force_transition"):
                self.state_machine.force_transition()

        # Increment turn counter if no progress was made
        if not deliverables_found and not tasks_completed:
            self.state_machine.increment_turn()

        # Clear state changed flag and emit progress
        self.state_machine.clear_state_changed_flag()

        execution_state = self.state_machine.execution_state
        if execution_state:
            progress_state = ProgressAdapter.from_execution_state(
                execution_state, started_at=self._session_started_at
            )
            yield AgentOutput.progress_update(
                session_id,
                progress_state,
                update_trigger="turn_completion",
                agent_name=self.agent_name,
                agent_icon="🧠",
            )

    def _handle_state_transition(
        self, session_id: str, reason: Optional[str] = None
    ) -> Optional[AgentOutput]:
        """Handle a state transition and return debug output (or None)."""
        old_state = self.state_machine.current_state
        old_id = old_state.id if old_state else "Unknown"
        old_title = old_state.title if old_state else "Unknown"

        if self.state_machine.advance_state():
            new_state = self.state_machine.current_state
            new_id = new_state.id if new_state else "Unknown"
            new_title = new_state.title if new_state else "Unknown"

            return AgentOutput.debug(
                session_id,
                f"State transition: {old_title} -> {new_title}",
                component="state_machine",
                stage="state_transition",
                from_state_id=old_id,
                from_state_title=old_title,
                to_state_id=new_id,
                to_state_title=new_title,
                transition_reason=reason or "all_tasks_complete",
            )
        return None

    # ─────────────────────────────────────────────────────────────────────
    # Session lifecycle
    # ─────────────────────────────────────────────────────────────────────

    async def on_session_start(self, session_id: str, config: Dict[str, Any]) -> None:
        """Initialize session: load plan, configure experts, set up state machine."""
        await super().on_session_start(session_id, config)

        self._session_started_at = datetime.utcnow().isoformat() + "Z"
        self.config = config
        self._plan_system_prompt = None

        # Load plan
        plan = self._load_plan_config(config)
        if plan:
            if self.state_machine.initialize(plan):
                print(f"[StellaV2Agent] State machine initialized: {plan.get('title', 'Unknown')}")
            else:
                print("[StellaV2Agent] Failed to initialize state machine from plan")

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
            self.expert_pool = ExpertPool(self.llm_service, self.expert_registry)

        # Apply LLM config overrides
        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        print(f"[StellaV2Agent] Session started: {session_id}")

    async def on_ready(self, session_id: str) -> AsyncIterator[AgentOutput]:
        """Send initial progress state when agent joins the room."""
        if self.state_machine.is_initialized and self.state_machine.execution_state:
            progress_state = ProgressAdapter.from_execution_state(
                self.state_machine.execution_state,
                started_at=self._session_started_at,
            )
            yield AgentOutput.progress_update(
                session_id,
                progress_state,
                update_trigger="session_start",
                agent_name=self.agent_name,
                agent_icon="🧠",
            )

    async def on_session_end(self, session_id: str) -> Dict[str, Any]:
        """Cleanup and return session summary."""
        result = await super().on_session_end(session_id)

        summary: Dict[str, Any] = {
            "agent": "stella-v2-agent",
            "llm_stats": self.llm_service.get_usage_stats(),
            **result,
        }

        if self.state_machine.is_initialized:
            todo_list = self.state_machine.get_todo_list()
            if todo_list:
                summary["state_machine"] = {
                    "plan_id": todo_list.plan_id,
                    "plan_title": todo_list.plan_title,
                    "final_state": todo_list.current_state_id,
                    "progress_percentage": todo_list.progress_percentage,
                    "completed_deliverables": todo_list.completed_deliverables,
                }
            self.state_machine = StateMachine()

        self.config = {}
        print(f"[StellaV2Agent] Session ended: {session_id}")
        return summary

    async def on_interrupt(self, session_id: str) -> None:
        """Handle user interrupt (barge-in)."""
        print(f"[StellaV2Agent] Interrupt received: {session_id}")
        self._is_processing = False

    async def on_config_update(self, session_id: str, config: Dict[str, Any]) -> None:
        """Handle runtime configuration update."""
        await super().on_config_update(session_id, config)
        self.config.update(config)

        if "model" in config:
            self.llm_service.default_config.model = config["model"]
        if "temperature" in config:
            self.llm_service.default_config.temperature = config["temperature"]

        print(f"[StellaV2Agent] Config updated: {list(config.keys())}")

    # ─────────────────────────────────────────────────────────────────────
    # Helper methods
    # ─────────────────────────────────────────────────────────────────────

    def _load_plan_config(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Load plan configuration from config or disk."""
        if "plan_id" in config:
            plan = self._load_plan(config["plan_id"])
            if plan:
                print(f"[StellaV2Agent] Loaded plan '{config['plan_id']}' from disk")
                return plan
            print(f"[StellaV2Agent] Failed to load plan '{config['plan_id']}'")

        elif "plan" in config:
            print("[StellaV2Agent] Using direct plan from config")
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
                    print(f"[StellaV2Agent] Loaded plan from {plan_file}")
                    return plan
                except (json.JSONDecodeError, OSError) as e:
                    print(f"[StellaV2Agent] Failed to load plan {plan_file}: {e}")

        print(f"[StellaV2Agent] Plan '{plan_id}' not found")
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
            print(f"[StellaV2Agent] Failed to fetch history: {e}")
            return []
