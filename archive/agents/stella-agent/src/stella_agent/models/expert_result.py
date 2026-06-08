"""Expert result model for ExpertPool responses."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ExpertResult:
    """Result from an expert agent analysis."""
    agent_name: str
    success: bool
    findings: str = ""
    risks: List[str] = field(default_factory=list)
    recommendation: str = ""
    confidence: float = 0.5
    raw_response: str = ""
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_success(
        cls,
        agent_name: str,
        findings: str,
        confidence: float = 0.8,
        risks: List[str] = None,
        recommendation: str = "",
        raw_response: str = ""
    ) -> "ExpertResult":
        """Create a successful expert result."""
        return cls(
            agent_name=agent_name,
            success=True,
            findings=findings,
            risks=risks or [],
            recommendation=recommendation,
            confidence=confidence,
            raw_response=raw_response
        )

    @classmethod
    def from_failure(
        cls,
        agent_name: str,
        error_message: str,
        error_type: str = "analysis_exception"
    ) -> "ExpertResult":
        """Create a failed expert result."""
        return cls(
            agent_name=agent_name,
            success=False,
            findings=f"Analysis failed: {error_message}",
            risks=["analysis_error"],
            recommendation="retry_or_fallback",
            confidence=0.0,
            error_type=error_type,
            error_message=error_message
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_name": self.agent_name,
            "success": self.success,
            "findings": self.findings,
            "risks": self.risks,
            "recommendation": self.recommendation,
            "confidence": self.confidence,
            "raw_response": self.raw_response,
            "error_type": self.error_type,
            "error_message": self.error_message,
            "metadata": self.metadata,
        }
