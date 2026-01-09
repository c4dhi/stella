# Plan Structure Documentation

## Overview

A **Plan** is a structured conversation blueprint that guides STELLA agents through multi-step interactions with users. Plans use a hierarchical state machine architecture to organize conversations into logical phases, tasks, and deliverables.

## Architecture

Plans follow a four-level hierarchy:

```
Plan
  └─ State (conversation phase)
      └─ Task (action to perform)
          └─ Deliverable (data to collect)
```

### Hierarchy Breakdown

1. **Plan**: The complete conversation blueprint
2. **State**: A major phase or stage of the conversation
3. **Task**: A specific action to complete within a state
4. **Deliverable**: A piece of information to extract and store

## Plan Structure

### Root Level: Plan

The plan is the top-level container defining the entire conversation flow.

```json
{
  "id": "unique_plan_identifier",
  "title": "Human-Readable Plan Name",
  "description": "What this conversation plan accomplishes",
  "initial_state_id": "first_state_id",
  "states": [...],
  "metadata": {
    "version": "1.0",
    "architecture": "state_machine",
    "states_count": 2,
    "tasks_count": 8,
    "deliverables_count": 7
  }
}
```

#### Plan Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the plan |
| `title` | string | Yes | Display name shown in UI |
| `description` | string | Yes | Summary of the plan's purpose |
| `initial_state_id` | string | Yes | ID of the first state to activate |
| `states` | array | Yes | List of State objects (see below) |
| `metadata` | object | No | Additional information about the plan |

### Level 2: State

A state represents a phase of the conversation. States execute sequentially, transitioning when their conditions are met.

```json
{
  "id": "getting_to_know_you",
  "title": "Getting to Know You",
  "type": "loose",
  "description": "Natural conversation to build connection",
  "tasks": [...],
  "transitions": [
    {
      "target_state_id": "next_state",
      "condition_type": "all_tasks_complete",
      "priority": 1
    }
  ]
}
```

#### State Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the state |
| `title` | string | Yes | Display name for this conversation phase |
| `type` | string | Yes | `"strict"` or `"loose"` (see State Types below) |
| `description` | string | Yes | What happens in this phase |
| `tasks` | array | Yes | List of Task objects |
| `transitions` | array | Yes | Conditions for moving to next state |

#### State Types

- **`loose`**: Flexible mode where tasks can be completed in any order. The agent handles tasks naturally based on conversation flow. Best for open-ended discussions.

- **`strict`**: Sequential mode where tasks must be completed one at a time in order. The agent focuses on one task before moving to the next. Best for structured processes like memory games or forms.

#### Transitions

Transitions define when to move from one state to another.

| Field | Type | Description |
|-------|------|-------------|
| `target_state_id` | string | ID of the state to transition to |
| `condition_type` | string | Transition trigger (usually `"all_tasks_complete"`) |
| `priority` | number | Order to evaluate transitions (1 = highest) |
| `condition_config` | object | Additional configuration for conditional logic |

### Level 3: Task

A task is a specific action the agent must perform, with clear instructions and deliverables to collect.

```json
{
  "id": "warm_introduction",
  "description": "Introduce yourself and learn user's name",
  "instruction": "Warmly introduce yourself as STELLA... Ask for their name...",
  "required": true,
  "deliverables": [...]
}
```

#### Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the task |
| `description` | string | Yes | Short summary of what to accomplish |
| `instruction` | string | Yes | Detailed guidance for the agent on how to complete this task |
| `required` | boolean | Yes | Must this task be completed to proceed? |
| `deliverables` | array | Yes | List of Deliverable objects (can be empty) |

#### Task Status (Runtime)

During execution, tasks have statuses:
- `pending`: Not yet started
- `in_progress`: Currently working on
- `completed`: All required deliverables collected
- `skipped`: Bypassed (if not required)

### Level 4: Deliverable

A deliverable is a specific piece of information to extract from the conversation.

```json
{
  "key": "user_name",
  "type": "string",
  "description": "The user's preferred name",
  "required": true,
  "acceptance_criteria": "Should be the name the user prefers to be called",
  "examples": ["Sarah", "John", "Alex", "Maria"]
}
```

#### Deliverable Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | Yes | Variable name for storing the value |
| `type` | string | Yes | Data type: `"string"`, `"number"`, or `"boolean"` |
| `description` | string | Yes | What information to collect |
| `required` | boolean | Yes | Must this be collected to complete the task? |
| `acceptance_criteria` | string | No | Validation rules or expectations |
| `examples` | array | No | Sample valid values to guide the agent |

#### Deliverable Status (Runtime)

During execution, deliverables track:
- `status`: `"pending"`, `"completed"`, or `"skipped"`
- `value`: The extracted information (null until collected)
- `reasoning`: Agent's explanation for the extracted value

## Complete Example

Here's a minimal complete plan:

```json
{
  "id": "simple_greeting",
  "title": "Simple Greeting Flow",
  "description": "Greet user and learn their name",
  "initial_state_id": "greeting",
  "states": [
    {
      "id": "greeting",
      "title": "Greeting Phase",
      "type": "loose",
      "description": "Warmly greet the user and introduce STELLA",
      "tasks": [
        {
          "id": "collect_name",
          "description": "Learn the user's name",
          "instruction": "Introduce yourself as STELLA and warmly ask for the user's name. Make them feel comfortable.",
          "required": true,
          "deliverables": [
            {
              "key": "user_name",
              "type": "string",
              "description": "The user's preferred name",
              "required": true,
              "acceptance_criteria": "A valid first name or nickname",
              "examples": ["Sarah", "John", "Alex"]
            }
          ]
        },
        {
          "id": "express_warmth",
          "description": "Express enthusiasm about meeting them",
          "instruction": "Express genuine warmth and excitement about meeting them. Use their name naturally.",
          "required": true,
          "deliverables": []
        }
      ],
      "transitions": [
        {
          "target_state_id": "farewell",
          "condition_type": "all_tasks_complete",
          "priority": 1
        }
      ]
    },
    {
      "id": "farewell",
      "title": "Farewell",
      "type": "loose",
      "description": "End the conversation warmly",
      "tasks": [
        {
          "id": "say_goodbye",
          "description": "Thank the user and say goodbye",
          "instruction": "Thank them for chatting and express that you hope to talk again soon. Use their name.",
          "required": true,
          "deliverables": []
        }
      ],
      "transitions": []
    }
  ],
  "metadata": {
    "version": "1.0",
    "architecture": "state_machine",
    "states_count": 2,
    "tasks_count": 3,
    "deliverables_count": 1
  }
}
```

## How Plans Work in Practice

### 1. Agent Loads Plan
When a conversation starts, the agent loads the plan JSON and activates the initial state.

### 2. Agent Works on Tasks
The agent follows task instructions, guiding the conversation naturally toward collecting deliverables.

### 3. Deliverables Are Collected
As the user speaks, the agent extracts information and fills in deliverable values with confidence scores.

### 4. Progress Advances
- When all required deliverables in a task are collected, the task is marked `completed`
- When all required tasks in a state are completed, the state's transition conditions are evaluated
- The agent transitions to the next state when conditions are met

### 5. Real-Time Updates
The frontend receives live progress updates showing:
- Current state and phase
- Active task
- Collected deliverable values
- Overall progress percentage

## State Types in Detail

### Loose Mode (`"loose"`)

**Best for:** Natural conversations, small talk, open-ended discussions

**Behavior:**
- Agent can work on multiple tasks simultaneously
- Task order is flexible based on conversation flow
- More natural and conversational
- User can provide information in any order

**Example Use Cases:**
- Getting to know someone (name, location, hobbies)
- Feedback collection
- Open discussion topics

### Strict Mode (`"strict"`)

**Best for:** Structured processes, step-by-step exercises, sequential flows

**Behavior:**
- Agent focuses on one task at a time
- Tasks must be completed in order
- More guided and controlled
- Clear progression through steps

**Example Use Cases:**
- Memory games with progressive difficulty
- Multi-step tutorials
- Forms with dependent fields
- Assessments with specific ordering

## Best Practices

### Writing Good Task Instructions

1. **Be specific**: Tell the agent exactly how to approach the task
2. **Set the tone**: Describe the desired style (warm, professional, playful)
3. **Provide context**: Explain why this task matters
4. **Give examples**: Show how the agent should phrase questions

Example:
```json
{
  "instruction": "Ask about their hobbies in a genuinely curious way. Show that you value diverse interests by mentioning that cognitive health flourishes when people engage with what they love. Listen actively and ask follow-up questions."
}
```

### Defining Clear Deliverables

1. **Use clear keys**: Variable names should be self-explanatory (`user_age`, not `data1`)
2. **Provide examples**: Help the agent understand valid formats
3. **Write acceptance criteria**: Define what makes a valid value
4. **Choose appropriate types**: Use `number` for ages, `boolean` for yes/no

### Organizing States

1. **Group related tasks**: Put logically connected tasks in the same state
2. **Keep states focused**: Each state should have a clear purpose
3. **Plan transitions**: Think about natural conversation flow between phases
4. **Balance granularity**: Too many states can be rigid, too few can be confusing

### Required vs Optional

- Mark tasks/deliverables as `required: false` if:
  - The conversation can proceed without them
  - User might decline to provide information
  - Information gathering is conditional

- Use `required: true` for:
  - Critical information needed for the conversation
  - Core tasks that define the conversation flow
  - Deliverables needed by later states

## Plan Storage and Usage

### File Location

Plans are stored as JSON files in:
```
agents/stella-agent/config/plans/
agents/stella-light-agent/config/plans/
```

### Loading Plans

Plans can be loaded by:
1. **Plan ID**: Reference by filename (e.g., `"plan": "stella_smalltalk"`)
2. **Full object**: Pass the complete plan JSON in the agent configuration

### Database Storage

Plans can also be stored in the database as "Plan Templates" and selected when deploying agents through the UI.

## Advanced Features

### Conditional Transitions

Beyond `all_tasks_complete`, you can create conditional transitions based on deliverable values:

```json
{
  "target_state_id": "advanced_level",
  "condition_type": "deliverable_value",
  "priority": 1,
  "condition_config": {
    "deliverable_key": "wants_to_continue",
    "expected_value": true
  }
}
```

### Multiple Transitions

States can have multiple transitions evaluated by priority:

```json
"transitions": [
  {
    "target_state_id": "expert_path",
    "condition_type": "deliverable_value",
    "priority": 1,
    "condition_config": {
      "deliverable_key": "experience_level",
      "expected_value": "expert"
    }
  },
  {
    "target_state_id": "beginner_path",
    "condition_type": "all_tasks_complete",
    "priority": 2
  }
]
```

## Real-World Examples

See these complete plan examples in the codebase:

1. **stella_smalltalk.json**: A warm introduction conversation where STELLA introduces herself and learns about the user
   - Location: `agents/stella-agent/config/plans/stella_smalltalk.json`
   - Features: Loose mode, natural conversation flow, 2 states

2. **cognitive_stimulation_demo_sm.json**: A progressive memory game with optional continuation
   - Location: `agents/stella-agent/config/plans/cognitive_stimulation_demo_sm.json`
   - Features: Mixed loose/strict modes, conditional transitions, 3 states

## Troubleshooting

### Common Issues

**Agent skips tasks**
- Check that `required: true` is set on critical tasks
- Verify task instructions are clear about what to accomplish

**State never transitions**
- Ensure all required deliverables have `required: true`
- Check that `target_state_id` matches an existing state
- Verify transition `condition_type` is correct

**Agent doesn't collect deliverables**
- Provide clear `acceptance_criteria` and `examples`
- Make sure `description` clearly explains what to collect
- Check that task `instruction` guides the agent to ask for this information

**Conversation feels rigid in loose mode**
- Review task instructions - they might be too prescriptive
- Consider if some tasks should be optional (`required: false`)
- Ensure instructions encourage natural conversation flow

## Schema Validation

All plans should follow this structure. The agent will validate the plan on load and report errors for:
- Missing required fields
- Invalid state types
- Broken state transitions (referencing non-existent states)
- Invalid deliverable types

## Further Reading

- See `agents/stella-agent/AGENT_ARCHITECTURE.md` for how plans integrate with the agent
- See `docs/stella-plan-structure.html` for a visual explanation
- See `agents/stella-ai-agent-sdk/src/stella_agent_sdk/plan/types.py` for the canonical type definitions
