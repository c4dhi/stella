---
sidebar_position: 3
title: "Configuration"
---

# Expert Configuration

Each expert is defined by a JSON configuration file. This page covers the configuration schema and expert selection logic.

## Configuration Schema

The `AgentConfig` dataclass defines the structure for expert configurations:

```python
@dataclass
class AgentConfig:
    name: str                           # Unique identifier
    description: str                    # What this expert analyzes
    trigger_keywords: List[str]         # Semantic triggers
    system_prompt: str                  # Expert's instructions
    model: str = "gpt-4o-mini"          # LLM model
    temperature: float = 0.3            # Response creativity
    max_tokens: int = 800               # Response length limit
    risk_threshold: float = 0.3         # Min risk score to activate
    relevant_intents: List[str] = []    # Intent types to respond to
    tools: List[str] = []               # Available tools
    always_active: bool = False         # Bypass selection logic
```

## Field Descriptions

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `str` | Unique identifier for the expert (e.g., "medical", "legal") |
| `description` | `str` | Human-readable description of what this expert analyzes |
| `trigger_keywords` | `List[str]` | Keywords that trigger this expert (semantic, not exact match) |
| `system_prompt` | `str` | Instructions that define expert behavior and response format |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `str` | `"gpt-4o-mini"` | LLM model to use for analysis |
| `temperature` | `float` | `0.3` | Response creativity (0.0-1.0, lower = more consistent) |
| `max_tokens` | `int` | `800` | Maximum response length |
| `risk_threshold` | `float` | `0.3` | Minimum risk score to activate (0.0-1.0) |
| `relevant_intents` | `List[str]` | `[]` | Intent types to respond to (e.g., "question", "request") |
| `tools` | `List[str]` | `[]` | Tool names available to this expert |
| `always_active` | `bool` | `false` | If true, runs on every query |

## Expert Selection Logic

The ExpertPool uses a multi-factor approach to select which experts analyze each query:

### Selection Process

```
┌─────────────────────────────────────────────────────────┐
│                  EXPERT SELECTION                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   1. Always-Active Check                                 │
│      └─► Experts with always_active: true               │
│          (e.g., Timekeeper) run on EVERY query          │
│                                                          │
│   2. Keyword Matching                                    │
│      └─► Check if any trigger_keywords appear           │
│          in the user input (case-insensitive)           │
│                                                          │
│   3. Risk Score Comparison                               │
│      └─► If content risk_score > expert.risk_threshold  │
│          then expert is selected                         │
│                                                          │
│   4. Intent Matching                                     │
│      └─► If user intent matches relevant_intents        │
│          then expert is selected                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Selection Code

```python
def should_analyze(self, user_input: str, intent: str, risk_score: float) -> bool:
    """Determine if this agent should analyze the input."""
    user_lower = user_input.lower()

    # Check keywords
    if any(keyword in user_lower for keyword in self.config.trigger_keywords):
        return True

    # Check risk threshold
    if risk_score > self.config.risk_threshold:
        return True

    # Check intent matching
    if self.config.relevant_intents and intent in self.config.relevant_intents:
        return True

    return False
```

## Risk Score Calculation

The ExpertPool calculates a risk score for each query using keyword-based heuristics:

```python
def _quick_analysis(self, user_input: str) -> tuple:
    user_lower = user_input.lower()
    risk_score = 0.0

    # Medical keywords add highest risk
    if any(word in user_lower for word in ["medical", "health", "doctor"]):
        risk_score += 0.4

    # Legal keywords add moderate-high risk
    if any(word in user_lower for word in ["legal", "law", "lawyer"]):
        risk_score += 0.3

    # Financial keywords add moderate risk
    if any(word in user_lower for word in ["invest", "money", "financial"]):
        risk_score += 0.2

    return intent, min(risk_score, 1.0)  # Cap at 1.0
```

### Risk Score Examples

| Query | Risk Score | Experts Triggered |
|-------|------------|-------------------|
| "Hello, how are you?" | 0.0 | Timekeeper only |
| "I have a headache" | 0.4 | Medical, Timekeeper |
| "Can I sue my landlord?" | 0.3 | Legal, Timekeeper |
| "Should I invest in crypto?" | 0.2 | Finance, Timekeeper |
| "My doctor says I need medicine for legal reasons" | 0.7 | Medical, Legal, Timekeeper |

## ExpertResult Schema

Expert output is captured in the `ExpertResult` dataclass:

```python
@dataclass
class ExpertResult:
    agent_name: str                          # Which expert produced this
    success: bool                            # Did analysis succeed?
    findings: str = ""                       # Analysis content
    risks: List[str] = field(default_factory=list)  # Identified risks
    recommendation: str = ""                 # Guidance for aggregator
    confidence: float = 0.5                  # Confidence in findings (0.0-1.0)
    raw_response: str = ""                   # Full LLM response
    error_type: Optional[str] = None         # Error category if failed
    error_message: Optional[str] = None      # Error details if failed
    metadata: Dict[str, Any] = field(default_factory=dict)  # Extra data
```

## Aggregator Synthesis

The Aggregator combines expert findings using these steps:

### 1. Conflict Analysis

Identifies disagreements between experts:
- Risk disagreements (some experts found risks, others didn't)
- Recommendation conflicts (multiple different recommendations)

### 2. Consensus Detection

Finds common ground across findings:
- Shared keywords (safe, proceed, caution, recommend, avoid)
- Agreement on risk level

### 3. Confidence Scoring

Calculates overall confidence:

```python
def _calculate_confidence(self, expert_results, conflict_analysis) -> float:
    # Average expert confidence
    avg_confidence = sum(r.confidence for r in successful) / len(successful)

    # Penalty for conflicts
    conflict_penalty = min(0.3, len(conflicts) * 0.1)

    # Penalty for failures
    failure_penalty = failure_rate * 0.2

    return max(0.0, min(1.0, avg_confidence - conflict_penalty - failure_penalty))
```

### 4. Response Synthesis Guidelines

- Responses target ~30-50 words
- Acknowledges user's interest without dwelling on issues
- Provides relevant guidance based on expert analysis
- Gently redirects potentially problematic conversations
- Maintains helpful, supportive tone

## Next Steps

- [Custom Experts](custom-experts) - Learn how to add and modify experts
- [Plan Structure](/docs/plan-structure) - Learn how to configure conversation flows with Plans
