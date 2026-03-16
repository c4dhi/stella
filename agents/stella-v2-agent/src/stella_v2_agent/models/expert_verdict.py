"""Expert verdict model.

Each expert returns a short structured verdict (not free-form text).
This replaces V1's ExpertResult which contained unstructured findings.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class ExpertVerdict:
    """Structured verdict from a single expert.

    Attributes:
        expert_name: Name of the expert that produced this verdict.
        verdict: Short categorical result (expert-specific, e.g. "clear", "none", "extracted").
        confidence: How confident the expert is in its verdict (0.0 to 1.0).
        recommendation: Brief actionable text for downstream stages.
        flags: Additional key-value flags for arbitration.
        priority: The expert's priority from its config (higher = more important).
        latency_ms: Time taken by this expert in milliseconds.
        success: Whether the expert call succeeded.
        error_message: Error description if the expert call failed.
        raw_output: Complete output from the expert. For JSON-mode experts, this is the parsed
            JSON dict. For tool-calling experts, this contains:
            {"tool_results": [...], "deliverables_set": [...], "tasks_completed": [...], "text_content": ""}.
    """
    expert_name: str
    verdict: str = ""
    confidence: float = 0.0
    recommendation: str = ""
    flags: Dict[str, Any] = field(default_factory=dict)
    priority: int = 0
    latency_ms: float = 0.0
    success: bool = True
    error_message: Optional[str] = None
    raw_output: Dict[str, Any] = field(default_factory=dict)

    def to_debug_dict(self) -> Dict[str, Any]:
        """Serialize for AgentOutput.debug() metadata."""
        result = {
            "expert_name": self.expert_name,
            "verdict": self.verdict,
            "confidence": self.confidence,
            "recommendation": self.recommendation,
            "priority": self.priority,
            "latency_ms": round(self.latency_ms, 1),
            "success": self.success,
        }
        if self.error_message:
            result["error_message"] = self.error_message
        if self.flags:
            result["flags"] = self.flags
        return result
