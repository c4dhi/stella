"""Stage 3: Deterministic Arbitration — priority-based conflict resolution.

No LLM call. Pure Python logic. Target latency: ~1ms.

Takes expert verdicts sorted by priority and produces a ResponseDirective
that is injected into the Response Generator's system prompt.

Conflict resolution rules:
- noise_detection "unclear" → short-circuit: ask user to repeat (highest priority override)
- medical/legal > task_extraction > probing > timekeeper
- If two experts contradict, higher priority wins
"""

import time
from typing import List, Dict, Any, Optional

from stella_v2_agent.models.expert_verdict import ExpertVerdict
from stella_v2_agent.models.arbitration_result import ArbitrationResult, ResponseDirective


# Default tone mapping: expert name → tone when that expert flags something
_DEFAULT_TONE_MAP: Dict[str, str] = {
    "medical": "cautious",
    "legal": "cautious",
    "noise_detection": "neutral",
    "task_extraction": "friendly",
    "probing": "curious",
    "timekeeper": "encouraging",
}

# Default verdicts that indicate the expert flagged something noteworthy
_DEFAULT_FLAGGING_VERDICTS: Dict[str, set] = {
    "noise_detection": {"unclear", "partial"},
    "medical": {"low", "high", "critical"},
    "legal": {"low", "high", "critical"},
    "task_extraction": {"tool_calls_executed"},
    "probing": {"needs_clarification", "gentle_redirect"},
    "timekeeper": {"slowing", "stuck", "force_advance"},
}

_DEFAULT_GATE_FAILURE_MESSAGE = "I'm sorry, I didn't quite catch that. Could you say that again?"


class Arbitration:
    """Deterministic arbitration engine: resolves expert conflicts without an LLM.

    Priority ordering (higher priority number = higher importance):
    noise_detection (100) > medical (95) > legal (90) > task_extraction (70) > probing (60) > timekeeper (50)
    """

    def __init__(self):
        self._tone_map: Dict[str, str] = dict(_DEFAULT_TONE_MAP)
        self._flagging_verdicts: Dict[str, set] = {
            k: set(v) for k, v in _DEFAULT_FLAGGING_VERDICTS.items()
        }
        self._gate_failure_message = _DEFAULT_GATE_FAILURE_MESSAGE

    def apply_config(self, config: dict) -> None:
        """Apply configuration overrides from Agent Configurator."""
        if "tone_map" in config and isinstance(config["tone_map"], dict):
            self._tone_map.update(config["tone_map"])
        if "gate_failure_message" in config:
            self._gate_failure_message = str(config["gate_failure_message"])

    def resolve(self, verdicts: List[ExpertVerdict], sm_context: Optional[Dict[str, Any]] = None) -> ArbitrationResult:
        """Resolve expert verdicts into a ResponseDirective.

        Args:
            verdicts: List of ExpertVerdict objects from the Expert Pool.

        Returns:
            ArbitrationResult containing the ResponseDirective for the Response Generator.
        """
        start_time = time.time()

        directive = ResponseDirective()
        conflicts: List[str] = []
        favored_expert = ""

        if not verdicts:
            latency_ms = (time.time() - start_time) * 1000
            return ArbitrationResult(directive=directive, latency_ms=latency_ms)

        # Sort by priority descending (highest priority first)
        sorted_verdicts = sorted(verdicts, key=lambda v: v.priority, reverse=True)

        # Filter to only successful verdicts that flagged something
        active_verdicts = [
            v for v in sorted_verdicts
            if v.success and self._is_flagging(v)
        ]

        # 1. Short-circuit: noise_detection says "unclear" → override everything
        noise_verdict = self._find_verdict(sorted_verdicts, "noise_detection")
        if noise_verdict and noise_verdict.success and noise_verdict.verdict == "unclear":
            directive.short_circuit = True
            directive.redirect_message = self._gate_failure_message
            directive.tone = "neutral"
            directive.expert_summary = f"noise_detection: unclear (confidence={noise_verdict.confidence:.2f})"
            favored_expert = "noise_detection"

            latency_ms = (time.time() - start_time) * 1000
            return ArbitrationResult(
                directive=directive,
                conflicts=["noise_detection overrode all other experts"],
                favored_expert=favored_expert,
                latency_ms=latency_ms,
            )

        # 2. Build directive from active verdicts in priority order
        #    IMPORTANT: task_extraction recommendations are internal metadata
        #    (e.g. "Collected user_name") — never surface them in the response.
        conversational_verdicts = [
            v for v in active_verdicts if v.expert_name != "task_extraction"
        ]

        if conversational_verdicts:
            primary = conversational_verdicts[0]
            favored_expert = primary.expert_name

            # Set tone from highest-priority flagging expert
            directive.tone = self._tone_map.get(primary.expert_name, "neutral")

            # Primary action — ONE direction from the highest-priority expert.
            directive.primary_action = primary.recommendation
        elif active_verdicts:
            # Only task_extraction flagged — keep neutral tone, no action directives
            favored_expert = active_verdicts[0].expert_name
            directive.tone = "neutral"

        # Must-avoid from medical/legal
        for v in active_verdicts:
            if v.expert_name in ("medical", "legal"):
                if v.verdict in ("high", "critical"):
                    if v.expert_name == "medical":
                        directive.must_avoid.append("specific medical diagnoses or treatment plans")
                    elif v.expert_name == "legal":
                        directive.must_avoid.append("specific legal advice or interpretations")

        # 3. Handle probing agent (follow-up decisions + deliverable signals)
        probing_verdict = self._find_verdict(sorted_verdicts, "probing")
        if probing_verdict and probing_verdict.success:
            if probing_verdict.verdict == "needs_clarification":
                directive.ask_followup = True
                directive.followup_question = probing_verdict.recommendation
            elif probing_verdict.verdict == "gentle_redirect":
                directive.force_redirect = True
                directive.redirect_message = probing_verdict.recommendation

            # Extract deliverable signals from probing's raw output
            signals = probing_verdict.raw_output.get("deliverable_signals", [])
            if isinstance(signals, list) and signals:
                directive.deliverable_signals = [s for s in signals if isinstance(s, str)]

        # 4. Handle timekeeper — when stuck, override probing with a direct
        #    redirect toward the pending deliverable to prevent going in circles.
        timekeeper_verdict = self._find_verdict(sorted_verdicts, "timekeeper")
        if timekeeper_verdict and timekeeper_verdict.success:
            if timekeeper_verdict.verdict in ("stuck", "force_advance"):
                # Build a specific redirect using pending deliverable info
                redirect = timekeeper_verdict.recommendation or ""
                if sm_context:
                    pending = [
                        d.get("description", d.get("key", ""))
                        for d in sm_context.get("deliverables", [])
                        if d.get("status") == "pending"
                    ]
                    if pending:
                        redirect = f"Ask directly about: {', '.join(pending[:2])}. Do not ask follow-up questions about other topics."

                # Timekeeper "stuck" overrides probing — force the redirect
                directive.ask_followup = True
                directive.followup_question = redirect

        # 5. Build expert summary
        summary_parts = []
        for v in sorted_verdicts:
            if v.success:
                summary_parts.append(
                    f"{v.expert_name}: {v.verdict} ({v.confidence:.2f})"
                )
        directive.expert_summary = ", ".join(summary_parts)

        # 6. Detect conflicts
        conflicts = self._detect_conflicts(active_verdicts)

        latency_ms = (time.time() - start_time) * 1000
        return ArbitrationResult(
            directive=directive,
            conflicts=conflicts,
            favored_expert=favored_expert,
            latency_ms=latency_ms,
        )

    def _is_flagging(self, verdict: ExpertVerdict) -> bool:
        """Check if the expert's verdict indicates it flagged something."""
        flagging_set = self._flagging_verdicts.get(verdict.expert_name)
        if flagging_set:
            return verdict.verdict in flagging_set
        # For unknown experts, any non-empty verdict is considered flagging
        return bool(verdict.verdict) and verdict.verdict not in ("none", "clear", "no_probe", "on_track")

    def _find_verdict(self, verdicts: List[ExpertVerdict], expert_name: str) -> Optional[ExpertVerdict]:
        """Find a specific expert's verdict in the list."""
        for v in verdicts:
            if v.expert_name == expert_name:
                return v
        return None

    def _detect_conflicts(self, active_verdicts: List[ExpertVerdict]) -> List[str]:
        """Detect contradictions between expert verdicts."""
        conflicts = []

        if len(active_verdicts) < 2:
            return conflicts

        # Check if medical/legal wants caution but probing wants more questions
        safety_experts = [v for v in active_verdicts if v.expert_name in ("medical", "legal")]
        probing_expert = next((v for v in active_verdicts if v.expert_name == "probing"), None)

        if safety_experts and probing_expert:
            for se in safety_experts:
                if se.verdict in ("high", "critical"):
                    conflicts.append(
                        f"{se.expert_name} ({se.verdict}) conflicts with probing ({probing_expert.verdict}): "
                        f"safety takes priority"
                    )

        return conflicts
