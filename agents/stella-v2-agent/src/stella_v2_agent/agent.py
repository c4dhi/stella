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
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator, Dict, Any, List, Optional

from stella_agent_sdk.agent.base import BaseAgent
from stella_agent_sdk.messages.input import AgentInput
from stella_agent_sdk.messages.output import AgentOutput
from stella_agent_sdk.messages.types import StatusSubtype, BargeInDecision
from stella_agent_sdk.services.state_machine_client import StateMachineClient
from stella_agent_sdk.tools import ToolRegistry
from stella_agent_sdk.tools.state_machine import create_state_machine_tools

from stella_v2_agent.llm.service import LLMService
from stella_v2_agent.experts.registry import ExpertRegistry
from stella_v2_agent.pipeline.input_gate import InputGate
from stella_v2_agent.pipeline.bridge_generator import BridgeGenerator
from stella_v2_agent.pipeline.expert_pool import ExpertPool
from stella_v2_agent.pipeline.arbitration import Arbitration
from stella_v2_agent.pipeline.response_generator import ResponseGenerator
from stella_v2_agent.pipeline.language_resolver import LanguageResolver
from stella_v2_agent.pipeline.barge_in_evaluator import BargeInEvaluator
from stella_v2_agent.adapters import ProgressAdapter
from stella_v2_agent.utils import normalize_transition_priority
import logging

logger = logging.getLogger(__name__)


# Prompt-compiler version this agent is written and tested against. Pinned on
# purpose (not the SDK's latest) so an SDK upgrade can't silently change how this
# agent's expert prompts compile. Bump deliberately when adopting a new compiler
# version. Can be overridden per deployment via config["compiler_version"].
PROMPT_COMPILER_VERSION = "1.0.0"


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

    # This agent supports user barge-in: it ships a Barge-in Evaluator stage
    # and its pipeline config exposes the barge-in prompt. Barge-in support is
    # an intrinsic property of the agent (the configuration depends on it), not
    # a client-side preference. Operators can still force it off at the
    # deployment level via BARGE_IN_ENABLED=false.
    supports_barge_in = True

    # Teleprompter (#241): light up the reply word-by-word as it is spoken.
    # On by default for this agent; operators can force off with
    # STELLA_TELEPROMPTER_ENABLED=false.
    supports_teleprompter = True

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

        # Explicit prompt-compiler version (never implicit/latest). Defaults to the
        # version this agent was authored against; overridable per deployment via
        # config["compiler_version"] in on_session_start.
        self._compiler_version: str = PROMPT_COMPILER_VERSION

        # Initialize core services
        self.llm_service = LLMService(config_path=llm_config_path)
        self.expert_registry = ExpertRegistry(experts_dir=experts_dir)

        # Initialize pipeline stages
        self.input_gate = InputGate(self.llm_service, self.expert_registry)
        self.bridge_generator = BridgeGenerator(self.llm_service)
        self.expert_pool = ExpertPool(
            self.llm_service, self.expert_registry,
            compiler_version=self._compiler_version,
        )
        self.arbitration = Arbitration()
        self.response_generator = ResponseGenerator(self.llm_service)
        self.barge_in_evaluator = BargeInEvaluator(self.llm_service)

        # Single source of truth for the conversation language (RFC §8).
        # One detection per turn, propagated to bridge + response + TTS.
        self.language_resolver = LanguageResolver()
        self._session_language: Optional[str] = None
        # Per-stream TTS voice (configured, not detected). See process().
        self._session_voice: Optional[str] = None

        # gRPC state machine client (initialized per session)
        self.sm_client: Optional[StateMachineClient] = None
        self.tool_registry: Optional[ToolRegistry] = None

        # Session state
        self.config: Dict[str, Any] = {}
        self._session_started_at: Optional[str] = None
        self._plan_system_prompt: Optional[str] = None
        self._plan_config: Optional[Dict[str, Any]] = None  # stored for context building
        self._custom_history_limit: int = 20  # overridable via pipeline_config thresholds
        self._last_known_state_id: Optional[str] = None
        self._last_state_id: Optional[str] = None  # for detecting state transitions between turns
        self._last_post_response_state_id: Optional[str] = None  # for analytics emission
        self._turn_counter: int = 0  # monotonic turn counter for analytics

        logger.info(
            f"Initialized with {self.expert_registry.enabled_count} experts"
        )

    # ─────────────────────────────────────────────────────────────────────
    # Analytics helpers
    # ─────────────────────────────────────────────────────────────────────

    def _elapsed_ms(self) -> float:
        """Milliseconds since stt_end for the current turn (analytics ground zero)."""
        if not self.has_audio or self.audio.turn_anchor_ts == 0:
            return 0.0
        return (time.perf_counter() - self.audio.turn_anchor_ts) * 1000

    # ─────────────────────────────────────────────────────────────────────
    # Main processing pipeline
    # ─────────────────────────────────────────────────────────────────────

    async def process(self, input: AgentInput) -> AsyncIterator[AgentOutput]:
        """Process user input through the 4-stage pipeline.

        Yields AgentOutput messages: status updates, text chunks, debug info,
        deliverables, progress updates.
        """
        self._is_processing = True
        self._turn_counter += 1
        # Prefer the STT transcript_id forwarded via metadata so audio-stage and
        # agent-stage analytics share one turn_id. Fall back to a local counter
        # for non-audio inputs (text-only, tests).
        forwarded_turn_id = (input.metadata or {}).get("turn_id")
        turn_id = forwarded_turn_id or f"turn_{self._turn_counter}"

        # Barge-in context: when the SDK commits a user interruption it feeds the
        # new transcript back through process() with is_barge_in=True. Expose it
        # as a template variable so configurable prompts (notably the bridge) can
        # react to "the user just interrupted me".
        is_barge_in = bool((input.metadata or {}).get("is_barge_in"))
        prompt_variables: Dict[str, Any] = {
            "isBargeIn": is_barge_in,
            "bargeInTranscript": input.text if is_barge_in else "",
            "userInput": input.text,
        }

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

            # Resolve the turn language BEFORE the bridge fires, so bridge,
            # response prompt ({{language}}), and TTS all read one value and
            # stay coherent (RFC §8 single source of truth). The plan's declared
            # language (if any) seeds resolution; confident detection overrides it.
            plan_language = (self._plan_config or {}).get("language")
            self.language_resolver.set_seed(plan_language)
            # Prefer STT's independent acoustic detection (voice); fall back to
            # the text classifier when absent (typed input / no signal, §8.3).
            meta = input.metadata or {}
            detected_language = meta.get("detected_language") or None
            language_signal = (
                (detected_language, float(meta.get("language_confidence") or 0.0))
                if detected_language
                else None
            )
            resolved_language = self.language_resolver.resolve(input.text, signal=language_signal)
            self._session_language = resolved_language
            sm_context["language"] = resolved_language
            logger.info(f"Resolved language for turn: {resolved_language}")

            # Resolve the per-stream TTS voice. Unlike language there is no
            # detection — the voice is a configured choice (plan-level), stamped
            # on every chunk so bridge and response are spoken in one coherent
            # voice. Providers that support voice selection honor it; others
            # disregard it. None → provider/env default.
            resolved_voice = (self._plan_config or {}).get("voice") or None
            self._session_voice = resolved_voice

            yield AgentOutput.status(
                input.session_id, "Processing your message...", StatusSubtype.PROCESSING
            )

            # ── Stage 1: Input Gate + Bridge Generator (parallel) ──
            logger.info(f"Stage 1: Input Gate + Bridge for: '{input.text}'")
            yield AgentOutput.analytics_event(
                input.session_id, "bridge_start", turn_id, self._elapsed_ms(),
            )
            gate_result, bridge = await asyncio.gather(
                self.input_gate.classify(input.text, history, sm_context),
                self.bridge_generator.generate(
                    input.text, history, language=resolved_language, variables=prompt_variables
                ),
            )

            yield AgentOutput.debug(
                input.session_id,
                f"InputGate: selected {len(gate_result.experts)} experts in {gate_result.latency_ms:.0f}ms",
                component="input_gate",
                **gate_result.to_debug_dict(),
            )

            # On gate failure: ignore bridge, send hardcoded message, skip all downstream stages
            if gate_result.failed:
                yield AgentOutput.analytics(
                    input.session_id, stage="safety_routing", timing_ms=0,
                    route="UNSAFE", experts_consulted=[], turn_id=turn_id,
                )
                yield AgentOutput.text_chunk(
                    input.session_id, self.arbitration.gate_failure_message, is_final=True
                )
                return

            # Shared transcript_id for bridge + response (one seamless utterance)
            transcript_id = f"response_{uuid.uuid4().hex[:8]}"

            # Emit bridge immediately for early TTS synthesis
            if bridge:
                logger.info(f"Bridge: '{bridge}'")
                yield AgentOutput.analytics_event(
                    input.session_id, "bridge_ready", turn_id, self._elapsed_ms(),
                    bridge_text=bridge,
                )
                bridge_output = AgentOutput.text_chunk(
                    input.session_id,
                    bridge,
                    transcript_id=transcript_id,
                    is_final=False,
                )
                bridge_output.metadata["tts_source"] = "bridge"
                bridge_output.metadata["language"] = resolved_language
                if resolved_voice:
                    bridge_output.metadata["voice"] = resolved_voice
                yield bridge_output

            # ── Stage 2: Expert Pool (all experts, including task_extraction) ──
            # All experts run in parallel and block until done. task_extraction
            # updates the state machine via tool calls (set_deliverable, etc.),
            # but we keep the ORIGINAL sm_context for response generation so
            # the agent still performs task instructions before advancing.

            experts_to_run = list(gate_result.experts)

            logger.info(f"Stage 2: Expert Pool — {experts_to_run}")
            all_verdicts = await self.expert_pool.run(
                experts_to_run, input.text, history, sm_context
            )

            for v in all_verdicts:
                yield AgentOutput.debug(
                    input.session_id,
                    f"Expert '{v.expert_name}': {v.verdict} ({v.confidence:.2f}) in {v.latency_ms:.0f}ms",
                    component=f"expert:{v.expert_name}",
                    **v.to_debug_dict(),
                )

            # Determine which deliverables were just collected by task_extraction
            # by comparing state machine before/after. This is more reliable than
            # reading deliverables_set from the runner's raw_output (which may
            # under-report due to batch_update result parsing issues).
            collected_keys: list = []
            if self.sm_client:
                pre_collected = set(sm_context.get("collected_deliverables", {}).keys())
                post_collected = await self.sm_client.get_collected_deliverables()
                collected_keys = [k for k in post_collected if k not in pre_collected]

            # ── Stage 3: Deterministic Arbitration (original context) ──
            logger.info("Stage 3: Arbitration")
            arb_result = self.arbitration.resolve(all_verdicts, sm_context)

            yield AgentOutput.debug(
                input.session_id,
                f"Arbitration: tone={arb_result.directive.tone}, favored={arb_result.favored_expert}",
                component="arbitration",
                **arb_result.to_debug_dict(),
            )

            # Analytics: safety/routing decision for this turn
            yield AgentOutput.analytics(
                input.session_id, stage="safety_routing", timing_ms=0,
                route="INTERCEPTED" if arb_result.directive.short_circuit else "SAFE",
                experts_consulted=list(gate_result.experts),
                turn_id=turn_id,
            )

            # Short-circuit: noise_detection override (ask user to repeat)
            if arb_result.directive.short_circuit:
                yield AgentOutput.text_chunk(
                    input.session_id,
                    arb_result.directive.redirect_message or self.arbitration.gate_failure_message,
                    is_final=True,
                )
                return

            # ── Stage 4: Response Generator (original context + collected keys filtered) ──
            # Pass collected keys so the response prompt filters them from "still need to collect",
            # preventing the agent from asking about deliverables the user already provided.
            logger.info("Stage 4: Response Generator (streaming)")
            yield AgentOutput.status(
                input.session_id, "Generating response...", StatusSubtype.PROCESSING
            )
            yield AgentOutput.analytics_event(
                input.session_id, "response_start", turn_id, self._elapsed_ms(),
            )

            sm_context["_collected_keys"] = collected_keys

            first_token_emitted = False
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
                if output.type.value == "text_chunk":
                    # Stamp the resolved language so the SDK sets the TTS voice
                    # for the main response, coherent with the bridge (RFC §8.2.1).
                    output.metadata["language"] = resolved_language
                    if resolved_voice:
                        output.metadata["voice"] = resolved_voice
                    if not first_token_emitted:
                        yield AgentOutput.analytics_event(
                            input.session_id, "response_first_token", turn_id, self._elapsed_ms(),
                        )
                        first_token_emitted = True
                yield output

            yield AgentOutput.analytics_event(
                input.session_id, "response_done", turn_id, self._elapsed_ms(),
            )

            # ── Stage 5: Post-response processing ──
            # Process extraction results, auto-complete no-deliverable tasks,
            # emit progress updates, and handle session completion.
            # Pass original task IDs so auto-complete only fires for tasks the
            # agent had in context (not tasks from a newly transitioned state).
            original_task_ids = {
                t.get("id") for t in sm_context.get("available_tasks", [])
            }
            # If the response prompt included a transition hint for a no-deliverable
            # task, include it so auto-complete fires for it on this turn.
            hinted_task_id = sm_context.get("_hinted_task_id")
            if hinted_task_id:
                original_task_ids.add(hinted_task_id)

            logger.info("Stage 5: Post-response processing")
            async for output in self._process_post_response(
                input.session_id, all_verdicts, gate_result, original_task_ids
            ):
                yield output

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
        original_task_ids: set = None,
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

        # Auto-complete no-deliverable tasks after the response has been generated.
        # The agent just performed the task instruction (either directly or via
        # the state transition hint); mark it done so the state machine can advance.
        # This runs even if task_extraction completed other tasks — a no-deliverable
        # task (like Introduction) needs auto-complete regardless.
        try:
            pending_tasks = await self.sm_client.get_pending_tasks()
            for task in pending_tasks:
                # Only auto-complete tasks the agent had in its original context.
                # Tasks from a newly transitioned state should wait until the
                # agent has a turn to perform their instruction.
                if original_task_ids and task.get("id") not in original_task_ids:
                    continue
                if not task.get("has_deliverables") and not task.get("is_preview"):
                    result = await self.sm_client.complete_task(
                        task["id"], "Task instruction performed by agent response"
                    )
                    tasks_completed = True
                    yield AgentOutput.debug(
                        session_id,
                        f"Auto-completed no-deliverable task: {task.get('description', task['id'])}",
                        component="post_response",
                    )
                    # Handle session completion triggered by this task
                    if result and result.get("session_completed"):
                        farewell = result.get("farewell_message")
                        if farewell:
                            yield AgentOutput.text_final(session_id, farewell)
                        self._session_completed = True
                        logger.info(
                            f"Session {session_id} completed via auto-complete"
                        )
                    break  # one task per turn
        except Exception as e:
            logger.error(f"Auto-complete error: {e}")

        # Fetch updated state once so we can:
        # 1) detect fallback completion when backend moved to __end__
        #    but tool payload did not set session_completed=true
        # 2) avoid incrementing turn counters after session termination
        full_state = await self.sm_client.get_full_state()
        reached_end_state = bool(full_state and full_state.get("current_state_id") == "__end__")

        # Fallback completion path:
        # If we reached __end__ but didn't receive session_completed in tool output,
        # emit the configured farewell from the plan metadata and stop the agent.
        if reached_end_state and not self._session_completed:
            farewell = None
            if task_verdict and task_verdict.raw_output:
                farewell = task_verdict.raw_output.get("farewell_message")
            if not farewell:
                farewell = self._plan_farewell_message()
            if farewell:
                yield AgentOutput.text_final(session_id, farewell)
            self._session_completed = True
            logger.info(
                f"Session {session_id} reached __end__ — fallback completion applied"
            )

        # Increment turn counter only when no progress was made and session is still active.
        if not deliverables_found and not tasks_completed and not reached_end_state:
            await self.sm_client.increment_turn()
            # Refresh state after counter update so the published progress is current.
            full_state = await self.sm_client.get_full_state()
            # increment_turn() re-evaluates transitions (#172), so an authored
            # turn_count_exceeded -> __end__ route can complete the session on this
            # very turn. Re-run the fallback completion here; otherwise the farewell
            # would only fire on the next cycle and the loop would accept a dangling
            # turn first (this turn's reached_end_state was computed pre-increment).
            if (
                full_state
                and full_state.get("current_state_id") == "__end__"
                and not self._session_completed
            ):
                reached_end_state = True
                farewell = self._plan_farewell_message()
                if farewell:
                    yield AgentOutput.text_final(session_id, farewell)
                self._session_completed = True
                logger.info(
                    f"Session {session_id} reached __end__ via turn increment — "
                    "fallback completion applied"
                )

        # ── Analytics emissions ──
        last_transition = None
        if full_state:
            current_state_id = full_state.get("current_state_id")
            previous_state_id = self._last_post_response_state_id

            # Build transition metadata if the state changed during this turn.
            if current_state_id and current_state_id != previous_state_id:
                last_transition = self._build_last_transition_metadata(
                    previous_state_id, current_state_id
                )

            # Update tracker AFTER comparison so the next turn sees this turn's end state.
            self._last_post_response_state_id = current_state_id

            # Analytics: plan completion snapshot (emitted each turn for dashboard)
            # progress is int 0-100 from gRPC; convert to 0-1 ratio
            yield AgentOutput.analytics(
                session_id, stage="plan_completion", timing_ms=0,
                completion_rate=full_state.get("progress", 0) / 100,
                plan_reached_end=reached_end_state,
                plan_id=full_state.get("plan_id"),
            )

        # Emit final progress for this turn.
        if full_state:
            current_state_id = full_state.get("current_state_id")
            last_transition = self._build_last_transition_metadata(
                from_state_id=self._last_known_state_id,
                to_state_id=current_state_id,
            )
            self._last_known_state_id = current_state_id

            progress_state = ProgressAdapter.from_full_state_dict(
                full_state,
                started_at=self._session_started_at,
                plan=self._plan_config,
                last_transition=last_transition,
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
        # Clear any resolved language from a previous session on this instance.
        self.language_resolver.reset()
        self._session_language = None
        self._session_voice = None
        # Explicit compiler version: config override, else the agent's pinned default.
        self._compiler_version = config.get("compiler_version") or PROMPT_COMPILER_VERSION

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
                compiler_version=self._compiler_version,
            )

        # Ensure the (possibly rebuilt) expert pool compiles prompts with the
        # session's resolved compiler version, honoring any config override.
        self.expert_pool.set_compiler_version(self._compiler_version)

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
                self._last_known_state_id = full_state.get("current_state_id")
                progress_state = ProgressAdapter.from_full_state_dict(
                    full_state,
                    started_at=self._session_started_at,
                    plan=self._plan_config,
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
            "barge_in": self.barge_in_evaluator,
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

        # Apply language resolver config (supported set, default, gating thresholds).
        language_config = pipeline_config.get("language")
        if isinstance(language_config, dict):
            self.language_resolver.apply_config(language_config)
            logger.info(f"Applied language config: {language_config}")

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
        self._last_known_state_id = None
        logger.info(f"Session ended: {session_id}")
        return summary

    async def on_interrupt(self, session_id: str) -> None:
        """Handle user interrupt (barge-in)."""
        logger.info(f"Interrupt received: {session_id}")
        self._is_processing = False

    async def on_barge_in(self, session_id: str, transcript: str) -> BargeInDecision:
        """Evaluate a user barge-in via the configurable Barge-in Evaluator.

        Delegates to the LLM-backed evaluator (whose prompt/model are editable
        in the Agent Configurator). The conversation history is fetched and
        passed so the decision is made IN CONTEXT — e.g. an on-topic answer to
        the assistant's last question is a real turn, not noise. Returning
        COMMIT makes the SDK discard the rest of the current reply and process
        ``transcript`` as a new turn; RESUME continues from where it suspended.
        """
        logger.info(f"Evaluating barge-in: '{transcript[:50]}'")
        try:
            history = await self._fetch_conversation_history(
                limit=self.barge_in_evaluator.history_limit
            )
        except Exception as e:
            logger.warning(f"Barge-in: could not fetch history ({e}); evaluating without it")
            history = []
        return await self.barge_in_evaluator.evaluate(transcript, conversation_history=history)

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

    def _plan_farewell_message(self) -> Optional[str]:
        """Resolve the configured farewell from plan metadata, if any.

        Used by the fallback completion path when the session reaches __end__
        without a tool payload carrying the farewell (e.g. a turn_count_exceeded
        route firing during increment_turn).
        """
        if not self._plan_config:
            return None
        return (
            self._plan_config.get("metadata", {})
            .get("plan_builder", {})
            .get("canvas", {})
            .get("end_node_config", {})
            .get("farewell_message")
        )

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

    def _build_last_transition_metadata(
        self,
        from_state_id: Optional[str],
        to_state_id: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        """Build transition metadata for frontend explanation in task sidebar."""
        if not from_state_id or not to_state_id or from_state_id == to_state_id:
            return None

        states = (self._plan_config or {}).get("states", [])
        if not isinstance(states, list):
            return {
                "from_state_id": from_state_id,
                "to_state_id": to_state_id,
            }

        source_state = next((s for s in states if s.get("id") == from_state_id), None)
        if not source_state:
            return {
                "from_state_id": from_state_id,
                "to_state_id": to_state_id,
            }

        transitions = source_state.get("transitions", []) or []
        matching = [
            t for t in transitions
            if t.get("target_state_id") == to_state_id
        ]

        # No direct matching transition means this update likely skipped across
        # multiple states in one turn; avoid emitting misleading branch metadata.
        if not matching:
            return None

        matching.sort(
            key=lambda t: normalize_transition_priority(t.get("priority"))
        )
        winner = matching[0]

        return {
            "from_state_id": from_state_id,
            "to_state_id": to_state_id,
            "condition_type": winner.get("condition_type"),
            "condition_config": winner.get("condition_config", {}),
            "priority": winner.get("priority"),
        }

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

        # Detect state transitions between turns
        state_just_changed = (
            self._last_state_id is not None
            and current_state_id != self._last_state_id
        )
        self._last_state_id = current_state_id

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
            "state_just_changed": state_just_changed,
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
