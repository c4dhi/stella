"""
STELLA Light Agent - Simplified single-LLM agent with prompt-based guardrails.

This is a lightweight version of stella-agent that:
- Uses a single LLM call instead of InputGate/ExpertPool/Aggregator pipeline
- Embeds safety guardrails directly in the system prompt
- Maintains full compatibility with the stella-ai-agent-sdk
- Supports the same plan format and state machine as stella-agent
"""

from stella_light_agent.agent import StellaLightAgent

__all__ = ["StellaLightAgent"]
__version__ = "0.1.0"
