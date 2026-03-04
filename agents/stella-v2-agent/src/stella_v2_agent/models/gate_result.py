"""Input Gate result model.

In V2, there is no SAFE/UNSAFE routing. Every input flows through all 4 stages.
The gate selects which experts to activate and provides cleaned input.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any


@dataclass
class GateResult:
    """Result from the Input Gate classification.

    Attributes:
        experts: List of expert names to activate for this input.
        cleaned_input: Optionally cleaned/normalized user input.
        failed: True if the gate LLM call failed entirely.
        latency_ms: Time taken for gate classification in milliseconds.
    """
    experts: List[str] = field(default_factory=list)
    cleaned_input: str = ""
    failed: bool = False
    latency_ms: float = 0.0

    def to_debug_dict(self) -> Dict[str, Any]:
        """Serialize for AgentOutput.debug() metadata."""
        return {
            "experts": self.experts,
            "failed": self.failed,
            "latency_ms": round(self.latency_ms, 1),
        }
