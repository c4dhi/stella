---
sidebar_position: 2
title: "States"
---

# States

States represent distinct phases of a conversation. Each state contains tasks to complete and defines rules for transitioning to other states.

## State Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique identifier for this state |
| `title` | `string` | Yes | — | Display name for the state |
| `type` | `string` | No | `"loose"` | Execution mode (`strict` or `loose`) |
| `description` | `string` | No | `""` | Purpose of this state |
| `tasks` | `array` | No | `[]` | Tasks to complete in this state |
| `transitions` | `array` | No | `[]` | Rules for moving to other states |

## Execution Modes

The `type` field determines how the agent processes tasks within the state.

### STRICT Mode

Sequential task processing — one task at a time, in order.

```json
{
  "id": "medical-intake",
  "title": "Medical Intake",
  "type": "strict",
  "tasks": [
    { "id": "symptoms", "description": "Collect symptoms" },
    { "id": "duration", "description": "Collect duration" },
    { "id": "medications", "description": "Collect medications" }
  ]
}
```

**Characteristics:**
- Tasks execute in array order (symptoms → duration → medications)
- Agent completes one task before moving to the next
- User cannot skip ahead
- Ensures all prerequisite information is collected

**Best for:**
- Medical or legal intake forms
- Step-by-step wizards
- Processes requiring specific order
- Compliance-sensitive workflows

### LOOSE Mode

Flexible task processing — agent chooses naturally based on conversation flow.

```json
{
  "id": "general-inquiry",
  "title": "General Inquiry",
  "type": "loose",
  "tasks": [
    { "id": "topic", "description": "Understand topic of interest" },
    { "id": "preferences", "description": "Learn user preferences" },
    { "id": "budget", "description": "Determine budget range" }
  ]
}
```

**Characteristics:**
- Agent can address tasks in any order
- Natural conversation flow
- User can provide information proactively
- Agent adapts to user's responses

**Best for:**
- Customer support conversations
- Sales discovery calls
- General information gathering
- Exploratory conversations

## Comparison Table

| Aspect | STRICT | LOOSE |
|--------|--------|-------|
| Task Order | Sequential | Flexible |
| User Control | Limited | High |
| Conversation Feel | Structured | Natural |
| Skip Tasks | Not allowed | Agent decides |
| Use Case | Forms, intake | Discovery, support |

## State Transitions

Transitions define when and how to move from one state to another.

### Transition Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `target_state_id` | `string` | Yes | — | State to transition to |
| `condition_type` | `string` | No | `"all_tasks_complete"` | Type of condition to evaluate |
| `priority` | `number` | No | `1` | Lower = higher priority |
| `condition_config` | `object` | No | `{}` | Additional condition parameters |

### Condition Types

#### `all_tasks_complete`

Transitions when all required tasks in the current state are completed.

```json
{
  "transitions": [
    {
      "target_state_id": "review",
      "condition_type": "all_tasks_complete",
      "priority": 1
    }
  ]
}
```

#### `deliverable_value`

Transitions when a specific deliverable has a specific value.

```json
{
  "transitions": [
    {
      "target_state_id": "premium-support",
      "condition_type": "deliverable_value",
      "priority": 1,
      "condition_config": {
        "deliverable_key": "membership_type",
        "expected_value": "premium"
      }
    },
    {
      "target_state_id": "standard-support",
      "condition_type": "deliverable_value",
      "priority": 2,
      "condition_config": {
        "deliverable_key": "membership_type",
        "expected_value": "standard"
      }
    }
  ]
}
```

#### `deliverable_exists`

Transitions when a deliverable has any value (not empty).

```json
{
  "transitions": [
    {
      "target_state_id": "has-referral",
      "condition_type": "deliverable_exists",
      "priority": 1,
      "condition_config": {
        "deliverable_key": "referral_code"
      }
    },
    {
      "target_state_id": "no-referral",
      "condition_type": "all_tasks_complete",
      "priority": 2
    }
  ]
}
```

### Transition Priority

When multiple transition conditions are satisfied, the transition with the lowest `priority` value wins.

```json
{
  "transitions": [
    {
      "target_state_id": "emergency",
      "condition_type": "deliverable_value",
      "priority": 1,
      "condition_config": {
        "deliverable_key": "urgency",
        "expected_value": "emergency"
      }
    },
    {
      "target_state_id": "standard-flow",
      "condition_type": "all_tasks_complete",
      "priority": 10
    }
  ]
}
```

In this example:
- If `urgency` equals `"emergency"`, go to `emergency` state (priority 1)
- Otherwise, when all tasks complete, go to `standard-flow` (priority 10)

## Complete State Example

```json
{
  "id": "customer-intake",
  "title": "Customer Intake",
  "type": "strict",
  "description": "Collect essential customer information before routing",
  "tasks": [
    {
      "id": "identify",
      "description": "Identify Customer",
      "instruction": "Ask for the customer's name and account number",
      "required": true,
      "deliverables": [
        {
          "key": "customer_name",
          "type": "string",
          "required": true
        },
        {
          "key": "account_number",
          "type": "string",
          "required": true
        }
      ]
    },
    {
      "id": "classify",
      "description": "Classify Issue",
      "instruction": "Determine the type of issue: billing, technical, or general",
      "required": true,
      "deliverables": [
        {
          "key": "issue_type",
          "type": "enum",
          "enum_values": ["billing", "technical", "general"],
          "required": true
        }
      ]
    }
  ],
  "transitions": [
    {
      "target_state_id": "billing-support",
      "condition_type": "deliverable_value",
      "priority": 1,
      "condition_config": {
        "deliverable_key": "issue_type",
        "expected_value": "billing"
      }
    },
    {
      "target_state_id": "technical-support",
      "condition_type": "deliverable_value",
      "priority": 1,
      "condition_config": {
        "deliverable_key": "issue_type",
        "expected_value": "technical"
      }
    },
    {
      "target_state_id": "general-support",
      "condition_type": "all_tasks_complete",
      "priority": 10
    }
  ]
}
```

## State Flow Diagram

A typical conversation flows through multiple states:

```
┌─────────────┐
│   Greeting  │  (loose) - Welcome user, collect name
└──────┬──────┘
       │ all_tasks_complete
       ▼
┌─────────────┐
│   Intake    │  (strict) - Collect required information
└──────┬──────┘
       │ deliverable_value (based on issue_type)
       ▼
┌─────────────────────────────────────┐
│  Billing │ Technical │   General   │
└────┬─────┴─────┬─────┴──────┬──────┘
     │           │            │
     └───────────┼────────────┘
                 │ all_tasks_complete
                 ▼
          ┌─────────────┐
          │   Farewell  │  (strict) - Close conversation
          └─────────────┘
```

## Next Steps

- [Tasks](/docs/plan-structure/tasks) — Learn about task configuration
- [Deliverables](/docs/plan-structure/deliverables) — Configure data collection
- [Examples](/docs/plan-structure/examples) — See complete plan examples
