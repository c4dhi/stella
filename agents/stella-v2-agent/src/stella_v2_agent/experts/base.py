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
        can_call_functions: Whether this expert uses tool calling (e.g. set_deliverable, complete_task).
            When True, the expert runs in tool-calling mode (OPENAI_DIRECT, no JSON mode).
            When False, the expert runs in JSON mode (OPENAI_LANGCHAIN, structured JSON output).
        system_prompt: The expert's system prompt.
        output_schema: Expected output format (for documentation, not enforced by code).
        output_format: Compact JSON example appended to the compiled prompt so the LLM knows the schema.
            Not used for tool-calling experts (output_format should be empty when can_call_functions=True).
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
    output_format: str = ""
    trigger_criteria: str = ""
    always_triggered: bool = False
    history_limit: int = 0  # 0 = use runner default (8 for most, 10 for task_extraction)
    min_confidence: float = 0.0  # 0 = not applicable (unused with tool-calling experts)

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
            output_format=data.get("output_format", ""),
            trigger_criteria=data.get("trigger_criteria", ""),
            always_triggered=data.get("always_triggered", False),
            history_limit=data.get("history_limit", 0),
            min_confidence=data.get("min_confidence", 0.0),
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
            "output_format": self.output_format,
            "trigger_criteria": self.trigger_criteria,
            "always_triggered": self.always_triggered,
            "history_limit": self.history_limit,
            "min_confidence": self.min_confidence,
        }
