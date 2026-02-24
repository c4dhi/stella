"""Expert runner: executes a single expert LLM call and returns a structured verdict.

Each expert gets:
- Its own system prompt (from config)
- User input + conversation history + state machine context
- JSON mode enabled for structured output

The runner handles timeouts, parsing, and error recovery.
"""

import json
import time
from typing import Dict, Any, List, Optional

from stella_v2_agent.experts.base import ExpertConfig
from stella_v2_agent.models.expert_verdict import ExpertVerdict
from stella_v2_agent.llm.service import LLMService, LLMConfig, LLMMessage, LLMProvider


class ExpertRunner:
    """Runs a single expert and returns a structured ExpertVerdict.

    The runner:
    1. Builds the expert's LLM messages (system + user)
    2. Calls the LLM in JSON mode (non-streaming)
    3. Parses the JSON response into an ExpertVerdict
    4. Handles timeouts and parsing failures gracefully
    """

    def __init__(self, llm_service: LLMService):
        self._llm_service = llm_service

    async def run(
        self,
        config: ExpertConfig,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
    ) -> ExpertVerdict:
        """Execute a single expert and return its verdict.

        Args:
            config: The expert's configuration.
            user_input: Current user message.
            conversation_history: Recent conversation messages.
            sm_context: State machine context for plan-aware experts.

        Returns:
            ExpertVerdict with the expert's structured response.
        """
        start_time = time.time()

        try:
            messages = self._build_messages(config, user_input, conversation_history, sm_context)
            llm_config = self._build_llm_config(config)

            response = await self._llm_service.generate(
                messages=messages,
                config=llm_config,
                component_name=f"expert:{config.name}",
            )

            latency_ms = (time.time() - start_time) * 1000

            return self._parse_verdict(config, response.content, latency_ms)

        except Exception as e:
            latency_ms = (time.time() - start_time) * 1000
            print(f"[ExpertRunner] Expert '{config.name}' failed: {e}")
            return ExpertVerdict(
                expert_name=config.name,
                verdict="error",
                confidence=0.0,
                recommendation=f"Expert failed: {str(e)[:100]}",
                priority=config.priority,
                latency_ms=latency_ms,
                success=False,
                error_message=str(e),
            )

    def _build_messages(
        self,
        config: ExpertConfig,
        user_input: str,
        conversation_history: List[Dict[str, str]],
        sm_context: Dict[str, Any],
    ) -> List[LLMMessage]:
        """Build LLM messages for the expert call."""
        messages = [LLMMessage(role="system", content=config.system_prompt)]

        # Build user message with context
        user_parts: List[str] = []

        # Inject deliverable context for plan-aware experts
        if config.name == "task_extraction" and sm_context:
            user_parts.append(self._build_task_extraction_context(sm_context))
        elif config.name == "probing" and sm_context:
            user_parts.append(self._build_probing_context(sm_context))

        # Conversation history (task_extraction runs in background with gpt-4o — give it full context)
        if conversation_history:
            limit = 10 if config.name == "task_extraction" else 8
            recent = conversation_history[-limit:]
            history_lines = [f"[{msg['role'].upper()}]: {msg['content']}" for msg in recent]
            user_parts.append("CONVERSATION:\n" + "\n".join(history_lines))

        user_parts.append(f"CURRENT USER MESSAGE: {user_input}")

        messages.append(LLMMessage(role="user", content="\n\n".join(user_parts)))
        return messages

    def _build_task_extraction_context(self, sm_context: Dict[str, Any]) -> str:
        """Build full plan context for task_extraction expert.

        Puts the CURRENT FOCUS (state + task) prominently at the top,
        then shows the rest of the plan below for cross-state extraction.
        """
        full_plan = sm_context.get("full_plan", [])
        if not full_plan:
            return self._build_task_extraction_context_legacy(sm_context)

        parts: List[str] = []

        # ── Current focus: what we're working on RIGHT NOW ──
        current_state_info = sm_context.get("state", {})
        current_task_info = sm_context.get("current_task")
        mode = sm_context.get("processing_mode", "loose")

        parts.append("=== CURRENT FOCUS ===")
        parts.append(f"State: {current_state_info.get('title', '?')}")
        if current_state_info.get("description"):
            parts.append(f"Goal: {current_state_info['description']}")
        parts.append(f"Mode: {'sequential (one task at a time)' if mode == 'strict' else 'flexible (any order)'}")

        if current_task_info:
            parts.append(f"Active task: {current_task_info.get('description', '?')}")
            if current_task_info.get("instruction"):
                parts.append(f"Instruction: {current_task_info['instruction']}")

        # Show current state's pending deliverables with full detail
        current_state_id = current_state_info.get("id", "")
        current_plan_state = next((s for s in full_plan if s.get("id") == current_state_id), None)
        if current_plan_state:
            pending_in_current = []
            for task in current_plan_state.get("tasks", []):
                for d in task.get("deliverables", []):
                    if d.get("status") == "pending":
                        pending_in_current.append(d)

            if pending_in_current:
                parts.append("")
                parts.append("PRIORITY — extract these if the user provided them:")
                for d in pending_in_current:
                    req = "required" if d.get("required") else "optional"
                    line = f"  ○ {d['key']} [{d.get('type', 'string')}, {req}]: {d.get('description', '')}"
                    criteria = d.get("acceptance_criteria", "")
                    if criteria:
                        line += f" (criteria: {criteria})"
                    examples = d.get("examples", [])
                    if examples:
                        line += f" (e.g. {', '.join(str(e) for e in examples)})"
                    parts.append(line)

        # ── Full plan: all states for cross-state extraction/overwrites ──
        parts.append("")
        parts.append("=== FULL PLAN (can also extract/overwrite deliverables in other states) ===")

        for state in full_plan:
            marker = " ← CURRENT" if state.get("is_current") else ""
            parts.append(f"\n## {state['title']}{marker}")

            for task in state.get("tasks", []):
                task_status = task.get("status", "pending")
                is_active = (current_task_info and task.get("id") == current_task_info.get("id"))
                task_marker = " ← ACTIVE TASK" if is_active else ""
                parts.append(f"  Task: {task['description']} ({task_status}){task_marker}")

                for d in task.get("deliverables", []):
                    status = d.get("status", "pending")
                    req = "required" if d.get("required") else "optional"
                    dtype = d.get("type", "string")

                    if status == "completed":
                        parts.append(f"    ✓ {d['key']} = {d.get('value', '?')}")
                    else:
                        parts.append(f"    ○ {d['key']} [{dtype}, {req}]: {d.get('description', '')}")

                if not task.get("has_deliverables"):
                    parts.append(f"    (no deliverables — mark completed when performed)")

        return "\n".join(parts)

    def _build_task_extraction_context_legacy(self, sm_context: Dict[str, Any]) -> str:
        """Fallback context builder using only current state deliverables."""
        parts: List[str] = []

        deliverables = sm_context.get("deliverables", [])
        pending = [d for d in deliverables if d.get("status") == "pending"]
        completed = [d for d in deliverables if d.get("status") == "completed"]

        if pending:
            parts.append("PENDING DELIVERABLES TO EXTRACT:")
            for d in pending:
                line = f"- {d['key']} ({d.get('type', 'string')}, {'required' if d.get('required') else 'optional'}): {d.get('description', '')}"
                criteria = d.get("acceptance_criteria", "")
                if criteria:
                    line += f"\n  Acceptance: {criteria}"
                examples = d.get("examples", [])
                if examples:
                    line += f"\n  Examples: {', '.join(str(e) for e in examples)}"
                parts.append(line)

        if completed:
            parts.append("\nCOMPLETED DELIVERABLES (already collected):")
            for d in completed:
                parts.append(f"- {d['key']}: {d.get('value', '?')}")

        return "\n".join(parts)

    def _build_probing_context(self, sm_context: Dict[str, Any]) -> str:
        """Build lightweight deliverable context for probing expert.

        Probing needs to know what deliverables are pending so it can detect
        whether the user provided any of them (deliverable_signals).
        """
        parts: List[str] = []

        deliverables = sm_context.get("deliverables", [])
        pending = [d for d in deliverables if d.get("status") == "pending"]
        completed = [d for d in deliverables if d.get("status") == "completed"]

        if pending:
            parts.append("PENDING DELIVERABLES (signal if user provided any):")
            for d in pending:
                parts.append(f"- {d['key']}: {d.get('description', '')}")
        else:
            parts.append("No pending deliverables.")

        if completed:
            parts.append("Already collected: " + ", ".join(d['key'] for d in completed))

        return "\n".join(parts)

    def _build_llm_config(self, config: ExpertConfig) -> LLMConfig:
        """Build LLM config for this expert call."""
        return LLMConfig(
            model=config.model,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
            provider=LLMProvider.OPENAI_LANGCHAIN,
            streaming=False,
            json_mode=True,
        )

    def _parse_verdict(
        self, config: ExpertConfig, raw_content: str, latency_ms: float
    ) -> ExpertVerdict:
        """Parse the expert's JSON response into an ExpertVerdict."""
        try:
            data = json.loads(raw_content)
        except json.JSONDecodeError:
            print(f"[ExpertRunner] Expert '{config.name}' returned invalid JSON: {raw_content[:200]}")
            return ExpertVerdict(
                expert_name=config.name,
                verdict="parse_error",
                confidence=0.0,
                recommendation="Expert returned invalid JSON",
                priority=config.priority,
                latency_ms=latency_ms,
                success=False,
                error_message=f"Invalid JSON: {raw_content[:100]}",
            )

        return ExpertVerdict(
            expert_name=config.name,
            verdict=data.get("verdict", ""),
            confidence=float(data.get("confidence", 0.0)),
            recommendation=data.get("recommendation", ""),
            flags={
                k: v for k, v in data.items()
                if k not in ("verdict", "confidence", "recommendation")
            },
            priority=config.priority,
            latency_ms=latency_ms,
            success=True,
            raw_output=data,
        )
