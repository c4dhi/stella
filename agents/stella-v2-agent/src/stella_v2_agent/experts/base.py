"""Base expert configuration model.

Defines the ExpertConfig dataclass that represents a loadable expert
definition from a JSON file, with environment variable overrides.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional


@dataclass
class ExpertConfig:
    """Configuration for a single expert, loaded from JSON.

    Attributes:
        name: Unique expert identifier (e.g. "noise_detection").
        description: What this expert does (shown to Input Gate).
        priority: Higher priority wins in arbitration conflicts.
        enabled: Whether this expert is active.
        model: LLM model to use for this expert.
        temperature: LLM temperature.
        max_tokens: Maximum tokens for expert response.
        can_call_functions: Whether this expert can trigger side-effects (e.g. state machine updates).
        system_prompt: The expert's system prompt.
        output_schema: Expected output format (for documentation, not enforced by code).
    """
    name: str
    description: str = ""
    priority: int = 50
    enabled: bool = True
    model: str = "gpt-4o-mini"
    temperature: float = 0.1
    max_tokens: int = 150
    can_call_functions: bool = False
    system_prompt: str = ""
    output_schema: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExpertConfig":
        """Create an ExpertConfig from a dictionary (typically loaded from JSON)."""
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            priority=data.get("priority", 50),
            enabled=data.get("enabled", True),
            model=data.get("model", "gpt-4o-mini"),
            temperature=data.get("temperature", 0.1),
            max_tokens=data.get("max_tokens", 150),
            can_call_functions=data.get("can_call_functions", False),
            system_prompt=data.get("system_prompt", ""),
            output_schema=data.get("output_schema", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "priority": self.priority,
            "enabled": self.enabled,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "can_call_functions": self.can_call_functions,
            "system_prompt": self.system_prompt,
            "output_schema": self.output_schema,
        }
