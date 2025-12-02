# GRACE Agent Architecture - Message Processing Pipeline

This document describes how the GRACE conversational AI agent processes messages from input to output, excluding STT/TTS implementation details.

## System Overview

```
User Input → Input Gate → [SAFE/UNSAFE routing] → Expert Pool (if UNSAFE) → Aggregator → Output
                ↓                                        ↓
          State Machine ←────────── Task Manager ←───────┘
                ↓
          Frontend Updates
```

---

## Phase 1: Input Gate

**File:** `message_processing/input_gate.py`

### Purpose
Classifies user messages as SAFE or UNSAFE, streams initial responses, detects deliverables, and routes to expert pool when needed.

### Input/Output Types

```python
# Input
user_input: str          # Raw user message
context: str             # Recent conversation history (last 8 messages)
enable_voice_narration: bool

# Output
@dataclass
class GateResult:
    verdict: str                    # "safe" or "unsafe"
    route: str                      # "SAFE" or "COMPLEX"
    response: str                   # Natural language response
    expert_configuration: Dict      # {"experts": ["ethics", "medical"], "reason": "..."}
    intent: str                     # "chitchat", "question", "request", "command"
    risk_score: float               # 0.0 - 1.0
    confidence: float
    transcript_id: str
    needs_expert_analysis: bool
```

### Prompt Construction (Context Engineering)

The system prompt is built from modular components (`prompt_components.py`):

1. **BaseInstructionsComponent**: Core GRACE identity + required output format
2. **StrictnessComponent**: Dynamic mode (strict/moderate/loose) based on plan settings
3. **DeliverableRulesComponent**: Rules for detecting/rejecting deliverables
4. **DeliverableExamplesComponent**: JSON examples (conditionally shown based on turn count)
5. **SafetyGuidelinesComponent**: SAFE vs UNSAFE routing criteria
6. **ConversationFlowComponent**: Current plan/step context

**Required LLM Output Order:**
```
1. THOUGHT: [1-2 sentences reasoning]
2. VERDICT: [SAFE] or [UNSAFE]
3. EXPERTS: [comma-separated list] or [NONE]
4. MESSAGE: [~30 word response, max 1 question]
5. DELIVERABLES: [JSON with value + reasoning] or [NONE]
6. STATE_TRANSITION: ["READY"] or [NONE]
```

**Why this order:** VERDICT/EXPERTS parsed first to trigger expert pool immediately. MESSAGE streams while experts run in background.

### User Message Construction

For state machine mode, builds context including:
- Current state info (title, type, description)
- State transition warnings (if state changed)
- Greeting detection warnings
- Recent conversation context with [MOST RECENT] / [RECENT] markers

For each task/deliverable in current state:
- Key, description, type, required flag
- Acceptance criteria
- Examples (only for PENDING deliverables)
- Current status (PENDING/COMPLETED/SKIPPED)
- Collected value (if completed)

### Output Streaming

`StreamingInputGateCallback` processes tokens as they arrive:

```python
async def on_token(self, token: str, accumulated_text: str):
    # 1. Parse VERDICT immediately (trigger expert pool)
    # 2. Parse EXPERTS immediately (parallel execution)
    # 3. Stream MESSAGE to frontend incrementally
    # 4. Send text chunks to TTS service
    # 5. Detect structural markers (DELIVERABLES, STATE_TRANSITION)
    # 6. Truncate TTS at structural markers
```

### State Updates

1. **Deliverable Detection:** Extracted from DELIVERABLES JSON, validated against greeting patterns
2. **State Machine Update:** If deliverable detected, updates `execution_state.set_deliverable_value()`
3. **Turn Counter:** Tracks turns without deliverables; triggers timekeeper at threshold
4. **State Transition:** If STATE_TRANSITION: ["READY"], evaluates and advances state

---

## Phase 2: Expert Pool

**File:** `message_processing/expert_pool.py`

### Purpose
Runs multiple domain experts in parallel when Input Gate returns UNSAFE verdict.

### Input/Output Types

```python
# Input
agent_names: List[str]    # ["ethics", "medical", "timekeeper"]
user_input: str
context: str

# Output per expert
{
    "agent_name": str,
    "findings": str,         # Natural language analysis
    "risks": List[str],      # Identified risks (if any)
    "recommendation": str,   # Suggested action
    "confidence": float,
    "success": bool
}
```

### Agent Configuration

Experts are auto-discovered from `agents/*.json`:

```python
@dataclass
class AgentConfig:
    name: str
    description: str
    trigger_keywords: List[str]
    system_prompt: str
    model: str
    temperature: float
    max_tokens: int
    risk_threshold: float
    relevant_intents: List[str]
    always_active: bool       # e.g., timekeeper always runs on UNSAFE
```

### Prompt Construction

```python
def _build_prompt(self, user_input: str, context: str) -> str:
    return f"""{self.config.system_prompt}

Conversation History: {context}

IMPORTANT GUIDELINES:
- Pay attention to [MOST RECENT] and [RECENT] messages
- Build upon previous analysis, don't repeat
- Focus on new insights

Current User Input: {user_input}

Provide concise, expert analysis..."""
```

### Parallel Execution

```python
async def run_parallel(agent_names, user_input, context):
    tasks = [agent.analyze(user_input, context) for agent in selected_agents]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return results  # Both successful and failed
```

### State Updates

- Sends `expert_status` messages to frontend (started/progress/completed/error)
- No direct state machine updates; findings passed to Aggregator

---

## Phase 3: Aggregator

**File:** `message_processing/aggregator.py`

### Purpose
Synthesizes expert findings into a natural response, handles conflict resolution, applies timekeeper recommendations.

### Input/Output Types

```python
# Input
user_input: str
expert_findings: List[Dict]      # From expert pool
input_gate_message: str          # Initial SAFE response
system_assessments: List[Dict]   # System status info
conversation_context: str
plan_context: Dict               # Current step/state info

# Output
@dataclass
class AggregatorResult:
    consolidated_response: str
    confidence_score: float
    conflicting_findings: List[str]
    transcript_id: str
    processing_time_ms: int
```

### Prompt Construction

**System Prompt** defines:
- Situation awareness (handling flagged content)
- Response strategy (acknowledge → redirect → focus on step)
- Tone guidelines (~30 words, max 1 question)
- Redirection techniques toward current step goals
- Output format (same as Input Gate)

**Synthesis Input** includes:
- Expert analysis results (successful + failed)
- Conflict analysis (risk disagreements, recommendation conflicts)
- Input gate message (for seamless continuation)
- System assessments and communication strategies
- Full plan context (current step, deliverables, remaining steps)
- Timekeeper analysis (if present)
- Force transition flag (if timekeeper recommends)

### Timekeeper Processing

Before synthesis, processes timekeeper expert results:

```python
def _process_timekeeper_analysis(expert_findings):
    # Extract: turns_without_deliverables, is_stuck, mode, recommendation
    # Parse suggested_deliverables JSON

def _extract_deliverables_from_timekeeper(timekeeper_analysis, user_input):
    # Apply suggested deliverables directly to state machine

def _should_force_transition(timekeeper_analysis):
    # Force if: recommendation=force_transition AND mode=strict AND turns>=2 AND stuck
```

### Output Streaming

`StreamingAggregatorCallback` streams tokens:

```python
async def on_token(self, token: str, accumulated_text: str):
    # Stream partial response to frontend
    # Send text chunks to TTS (if enabled)
    # Detect structural markers, truncate TTS
```

### State Updates

- Aggregator does NOT directly update state machine
- Timekeeper deliverables applied during timekeeper processing
- Main state updates handled by Input Gate and Task Manager

---

## Phase 4: State Machine

**File:** `message_processing/state_machine.py`

### Purpose
Manages conversation flow through states (STRICT/LOOSE modes) and tracks task/deliverable completion.

### Key Types

```python
# State types
class StateType(Enum):
    STRICT = "strict"   # Sequential task processing
    LOOSE = "loose"     # Parallel/flexible task processing

# Deliverable status
class DeliverableStatus(Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    SKIPPED = "skipped"

# Processing result
@dataclass
class TaskProcessingResult:
    completed_tasks: List[str]
    updated_deliverables: List[str]
    state_complete: bool
    should_advance: bool
    next_available_tasks: List[Task]
```

### Processing Modes

**STRICT Mode:**
- Only current task can be processed
- Tasks must complete in order
- Next task only available after current completes

```python
async def _process_strict_tasks(user_message, available_tasks):
    current_task = available_tasks[0]  # Only first
    completed_deliverables = await _detect_task_deliverables(user_message, current_task)
    if _is_task_complete(current_task):
        execution_state.complete_task(current_task.id)
```

**LOOSE Mode:**
- All available tasks can be processed in parallel
- Deliverables can be updated with new evidence
- More flexible conversation flow

```python
async def _process_loose_tasks(user_message, available_tasks):
    for task in available_tasks:  # All tasks
        completed_deliverables = await _detect_task_deliverables(user_message, task)
        if _is_task_complete(task):
            execution_state.complete_task(task.id)
```

### State Context for Prompts

```python
def get_current_context() -> Dict:
    return {
        "available_tasks": [...],           # Tasks that can be worked on
        "processing_mode": "strict|loose",
        "state": {"id", "type", "title", "description"},
        "current_task": {...},              # In STRICT mode
        "next_task": {...},                 # For transition preparation
        "next_state": {...},                # Upcoming state preview
        "conditional_paths": {...},         # Decision point info
        "progress_summary": {...}
    }
```

### State Transitions

1. Check if all required deliverables completed
2. Evaluate state transitions (conditions)
3. Advance to next state if ready
4. Send notifications to frontend

---

## Phase 5: Message Processor (Orchestrator)

**File:** `message_processing/processor.py`

### Purpose
Orchestrates the entire pipeline and manages conversation history.

### Main Flow

```python
async def process_message(user_text, participant_id, is_voice, enable_voice):
    # 1. Echo text messages to frontend (immediate feedback)
    if not is_voice:
        await echo_user_transcription(user_text, participant_id)

    # 2. Initialize plan on first message (if needed)
    if is_first_message:
        task_manager.initialize_first_step()
        await send_plan_to_frontend()

    # 3. Input Gate - streaming routing decision
    gate_result = await input_gate.process_streaming(user_text, context, enable_voice)

    # 4. Route based on verdict
    if gate_result.verdict == "safe":
        _add_conversation_turn(user_text, gate_result.response, "input_gate")
        await _send_complete_todo_list_update("safe_route_completed")

    elif gate_result.verdict == "unsafe":
        # Run expert pool
        expert_results = await expert_pool.run_parallel(
            gate_result.expert_configuration["experts"],
            user_text, context
        )

        # Aggregate findings
        aggregator_result = await aggregator.synthesize_streaming(
            user_text, expert_results, gate_result.response, ...
        )

        _add_conversation_turn(user_text, aggregator_result.consolidated_response,
                              "aggregator", gate_result.response)
        await _send_complete_todo_list_update("unsafe_route_completed")
```

### Conversation History Management

```python
def _get_recent_context() -> str:
    recent_messages = conversation_history[-8:]  # Last 4 exchanges

    for i, msg in enumerate(recent_messages):
        if i >= len - 2:
            context_parts.append(f"[MOST RECENT] {role}: {content}")
        elif i >= len - 4:
            context_parts.append(f"[RECENT] {role}: {content}")
        else:
            context_parts.append(f"{role}: {content}")

    return "\n".join(context_parts)

def _add_conversation_turn(user_text, final_response, response_type, input_gate_response=None):
    _add_to_history_silent("user", user_text)
    if response_type == "aggregator" and input_gate_response:
        _add_to_history_silent("assistant", input_gate_response)
    _add_to_history_silent("assistant", final_response)

    # Keep last 20 messages
    if len(conversation_history) > 20:
        conversation_history = conversation_history[-20:]
```

---

## Frontend Communication

**File:** `message_processing/stream_service.py`

All updates sent via LiveKit data channels (JSON over WebSocket).

### Message Types

| Method | Purpose |
|--------|---------|
| `send_transcript_chunk` | Stream partial/final responses |
| `send_decision_stream` | Processing status updates |
| `send_expert_status` | Expert progress (started/completed/error) |
| `send_expert_results` | Summary of expert analysis |
| `send_complete_todo_list` | Full plan state snapshot |
| `send_plan_progress_update` | Progress percentage, current state |
| `send_deliverable_detected` | Real-time deliverable collection |
| `send_plan_completed` | Plan completion notification |

### Data Channel Transport

```python
async def _send_message(message: dict) -> bool:
    message_json = json.dumps(message)
    message_bytes = message_json.encode("utf-8")
    await room.local_participant.publish_data(message_bytes, reliable=True)
```

---

## Key Implementation Notes

### Parallel Execution Patterns

1. **Input Gate + Expert Pool:** Expert pool starts immediately when VERDICT parsed (before MESSAGE finishes streaming)
2. **Expert Pool internally:** All experts run via `asyncio.gather()`
3. **Streaming + TTS:** Text chunks sent to TTS service during token streaming

### Deliverable Detection Flow

1. **LLM Detection:** Input Gate LLM outputs DELIVERABLES JSON with value + reasoning
2. **Validation:** `_validate_deliverables_not_greetings()` checks against greeting patterns
3. **State Update:** `state_machine.execution_state.set_deliverable_value()`
4. **Frontend Notification:** `send_deliverable_detected()` for real-time UI update

### Timekeeper Intervention

Triggered when turn counter exceeds threshold without deliverables:

1. Input Gate increments turn counter if no deliverables extracted
2. At threshold, overrides VERDICT to UNSAFE with EXPERTS: [timekeeper]
3. Timekeeper expert analyzes stuck conversation
4. Aggregator applies suggested deliverables and may force transition

### State Transition Logic

```python
# In StateMachineExecutionState
def is_current_state_complete() -> bool:
    for task in current_state.tasks:
        if task.required and task.status != TaskStatus.COMPLETED:
            return False
    return True

def evaluate_state_transitions() -> Optional[str]:
    for transition in current_state.transitions:
        if transition.evaluate_condition(deliverable_states):
            return transition.target_state_id
    return None
```

---

## Example Message Flow

**User says:** "Hi, my name is Felix"

1. **Input Gate:**
   - Builds prompt with state machine context
   - LLM outputs: `VERDICT: [SAFE], EXPERTS: [NONE], MESSAGE: "Hi Felix! Nice to meet you...", DELIVERABLES: {"user_name": {"value": "Felix", "reasoning": "User stated their name"}}`
   - Streams MESSAGE to frontend + TTS
   - Validates deliverable (not a greeting)
   - Updates state machine: `set_deliverable_value("user_name", "Felix", ...)`

2. **State Machine:**
   - Updates deliverable state to COMPLETED
   - Checks if task complete (all required deliverables)
   - If yes, marks task complete
   - Checks if state complete (all required tasks)
   - If yes, evaluates transition to next state

3. **Frontend:**
   - Receives transcript chunks (streaming)
   - Receives deliverable_detected notification
   - Receives complete_todo_list update
   - Updates UI accordingly
