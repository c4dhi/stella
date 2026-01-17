---
sidebar_position: 1
title: "Overview"
---

# Plan Structure Overview

Plans are JSON-based conversation blueprints that define how STELLA agents conduct guided conversations. A Plan specifies the flow of states, tasks to complete, and data to collect from users.

## Plan Hierarchy

Plans follow a hierarchical structure where each level serves a specific purpose:

```
Plan (Root)
├── States (Conversation Phases)
│   └── Tasks (Specific Actions)
│       └── Deliverables (Data to Collect)
└── Metadata (system_prompt, initial_state_id, etc.)
```

### Component Relationships

| Component | Contains | Purpose |
|-----------|----------|---------|
| **Plan** | States | Top-level container defining the entire conversation flow |
| **State** | Tasks | Distinct phase of conversation (e.g., Greeting, Data Collection) |
| **Task** | Deliverables | Individual unit of work within a state |
| **Deliverable** | — | Specific piece of information to collect |

## How Plans Configure Agent Behavior

When a STELLA agent loads a plan:

1. **Initialization** — Agent reads the plan and sets up the state machine
2. **Starting State** — Agent enters the `initial_state_id` state
3. **Task Execution** — Agent works through tasks based on state type (strict or loose)
4. **Data Collection** — Agent extracts deliverables from user responses
5. **State Transitions** — Agent moves to new states when transition conditions are met
6. **Completion** — Plan ends when final state tasks are complete

## Plan Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the plan |
| `title` | `string` | Yes | Human-readable name |
| `description` | `string` | No | Overview of the plan's purpose |
| `initial_state_id` | `string` | No | Starting state (defaults to first state) |
| `states` | `array` | Yes | Array of state definitions |
| `system_prompt` | `string` | No | Agent persona and behavior instructions |
| `session_context` | `object` | No | Fields to collect at session start |
| `metadata` | `object` | No | Additional metadata (version, notes, etc.) |

## Quick Example

Here's a minimal plan with two states:

```json
{
  "id": "simple-greeting",
  "title": "Simple Greeting Flow",
  "description": "A basic greeting and farewell conversation",
  "initial_state_id": "greeting",
  "system_prompt": "You are a friendly assistant. Be warm and helpful.",
  "states": [
    {
      "id": "greeting",
      "title": "Greeting",
      "type": "loose",
      "description": "Welcome the user and collect their name",
      "tasks": [
        {
          "id": "welcome",
          "description": "Welcome Task",
          "instruction": "Greet the user warmly and ask for their name",
          "required": true,
          "deliverables": [
            {
              "key": "user_name",
              "type": "string",
              "description": "The user's name",
              "required": true
            }
          ]
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
      "type": "strict",
      "description": "Say goodbye to the user",
      "tasks": [
        {
          "id": "goodbye",
          "description": "Goodbye Task",
          "instruction": "Thank the user by name and wish them well",
          "required": true,
          "deliverables": []
        }
      ],
      "transitions": []
    }
  ]
}
```

## Session Context

The `session_context` field allows you to define information collected from participants before the conversation starts:

```json
{
  "session_context": {
    "fields": [
      {
        "id": "participant_name",
        "label": "Your Name",
        "type": "string",
        "required": true,
        "description": "Enter your full name"
      },
      {
        "id": "preferred_language",
        "label": "Preferred Language",
        "type": "select",
        "required": false,
        "options": ["English", "Spanish", "French", "German"]
      }
    ]
  }
}
```

### Session Context Field Types

| Type | Description |
|------|-------------|
| `string` | Free-form text input |
| `number` | Numeric value |
| `boolean` | True/false toggle |
| `select` | Dropdown with predefined options |

## Source Reference

The Plan type definitions are located in the STELLA Agent SDK:

```
agents/stella-ai-agent-sdk/src/stella_agent_sdk/plan/types.py
```

## Next Steps

- [States](/docs/plan-structure/states) — Learn about conversation phases and transitions
- [Tasks](/docs/plan-structure/tasks) — Understand task execution and configuration
- [Deliverables](/docs/plan-structure/deliverables) — Configure data collection
- [Examples](/docs/plan-structure/examples) — See complete plan examples
