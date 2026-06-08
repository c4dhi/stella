"""Gate result model for InputGate decisions."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum


class GateRoute(str, Enum):
    """Routing decision from InputGate."""
    SAFE = "SAFE"
    UNSAFE = "UNSAFE"


@dataclass
class GateResult:
    """Result from InputGate analysis."""
    route: GateRoute
    confidence: float
    message: str
    experts_to_consult: List[str] = field(default_factory=list)
    deliverables: Dict[str, Any] = field(default_factory=dict)
    completed_tasks: List[str] = field(default_factory=list)
    state_transition: Optional[str] = None
    reasoning: str = ""
    expert_configuration: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_safe(self) -> bool:
        return self.route == GateRoute.SAFE

    @property
    def needs_expert_analysis(self) -> bool:
        return self.route == GateRoute.UNSAFE and len(self.experts_to_consult) > 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "route": self.route.value,
            "confidence": self.confidence,
            "message": self.message,
            "experts_to_consult": self.experts_to_consult,
            "deliverables": self.deliverables,
            "completed_tasks": self.completed_tasks,
            "state_transition": self.state_transition,
            "reasoning": self.reasoning,
            "expert_configuration": self.expert_configuration,
        }
