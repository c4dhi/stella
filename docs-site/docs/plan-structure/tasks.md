---
sidebar_position: 3
title: "Tasks"
---

# Tasks

Tasks are individual units of work within a state. Each task represents something the agent needs to accomplish, often involving collecting information from the user through deliverables.

## Task Properties

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique identifier within the state |
| `description` | `string` | Yes | — | Task title/name |
| `instruction` | `string` | No | `""` | Detailed guidance for the agent |
| `required` | `boolean` | No | `true` | Must complete before state transition |
| `deliverables` | `array` | No | `[]` | Information to collect |

## Task Properties Explained

### `id`

A unique identifier for the task within its parent state. Use descriptive, snake_case names.

```json
{
  "id": "collect_contact_info"
}
```

### `description`

A short title or name for the task. This is what the task "is" — keep it concise.

```json
{
  "description": "Collect Contact Information"
}
```

### `instruction`

Detailed instructions telling the agent how to accomplish the task. This is where you provide context, tone guidance, and specific behaviors.

```json
{
  "instruction": "Politely ask the user for their email address and phone number. Explain that this information will be used to send appointment confirmations. If they're hesitant, reassure them about privacy."
}
```

**Good instructions:**
- Explain the purpose of the task
- Describe the desired tone or approach
- Handle edge cases (user hesitation, unclear responses)
- Provide context the agent needs

### `required`

Whether this task must be completed before the state can transition.

```json
{
  "required": true
}
```

- `true` (default): Task must complete before transition
- `false`: Task can be skipped; state can transition without it

### `deliverables`

An array of specific pieces of information to collect during this task. See [Deliverables](/docs/plan-structure/deliverables) for full details.

## Task Completion

A task is considered **complete** when:

1. All **required** deliverables have been collected
2. Optional deliverables may be skipped

In **STRICT** mode, the agent moves to the next task only after completing the current one.

In **LOOSE** mode, the agent may work on multiple tasks based on conversation flow.

## Task Examples

### Simple Task (No Deliverables)

Some tasks don't collect data — they just perform an action.

```json
{
  "id": "welcome",
  "description": "Welcome Message",
  "instruction": "Warmly greet the user and introduce yourself as their virtual assistant. Mention that you're here to help with their appointment scheduling.",
  "required": true,
  "deliverables": []
}
```

### Task with Single Deliverable

```json
{
  "id": "get_name",
  "description": "Collect User Name",
  "instruction": "Ask the user for their full name. Be friendly and explain you need it for their records.",
  "required": true,
  "deliverables": [
    {
      "key": "user_name",
      "type": "string",
      "description": "User's full name",
      "required": true,
      "acceptance_criteria": "Must include first and last name"
    }
  ]
}
```

### Task with Multiple Deliverables

```json
{
  "id": "collect_contact",
  "description": "Collect Contact Information",
  "instruction": "Gather the user's contact details. Ask for email first, then phone number. Phone is optional.",
  "required": true,
  "deliverables": [
    {
      "key": "email",
      "type": "string",
      "description": "Email address",
      "required": true,
      "acceptance_criteria": "Valid email format with @ symbol",
      "examples": ["user@example.com", "john.doe@company.org"]
    },
    {
      "key": "phone",
      "type": "string",
      "description": "Phone number",
      "required": false,
      "acceptance_criteria": "10+ digits, can include country code",
      "examples": ["+1-555-123-4567", "555-123-4567"]
    }
  ]
}
```

### Task with Enum Deliverable

```json
{
  "id": "select_service",
  "description": "Select Service Type",
  "instruction": "Ask what type of service the user needs. Present the three options clearly.",
  "required": true,
  "deliverables": [
    {
      "key": "service_type",
      "type": "enum",
      "description": "Type of service requested",
      "required": true,
      "enum_values": ["consultation", "follow-up", "emergency"],
      "examples": ["consultation"]
    }
  ]
}
```

### Optional Task

```json
{
  "id": "collect_referral",
  "description": "Referral Code",
  "instruction": "Ask if the user has a referral code. If they don't have one or seem confused, skip this task.",
  "required": false,
  "deliverables": [
    {
      "key": "referral_code",
      "type": "string",
      "description": "Optional referral code",
      "required": false
    }
  ]
}
```

## Writing Effective Instructions

### Do's

| Practice | Example |
|----------|---------|
| Be specific | "Ask for their preferred appointment date, suggesting next week's available slots" |
| Include tone | "Warmly and professionally ask..." |
| Handle edge cases | "If the user is unsure, offer to explain the options" |
| Provide context | "This information is needed for insurance verification" |

### Don'ts

| Avoid | Why |
|-------|-----|
| Vague instructions | "Get the information" — agent doesn't know what or how |
| Technical jargon | User-facing conversation should be natural |
| Assuming context | Agent may not know background without explicit instruction |
| Overly long instructions | Keep focused; break into multiple tasks if needed |

## Task Organization Patterns

### Sequential Information Gathering

For forms or intake processes, use **STRICT** mode:

```json
{
  "type": "strict",
  "tasks": [
    { "id": "name", "description": "Get Name", "required": true },
    { "id": "dob", "description": "Get Date of Birth", "required": true },
    { "id": "address", "description": "Get Address", "required": true }
  ]
}
```

### Conversational Discovery

For natural conversations, use **LOOSE** mode:

```json
{
  "type": "loose",
  "tasks": [
    { "id": "interests", "description": "Discover Interests", "required": true },
    { "id": "budget", "description": "Understand Budget", "required": false },
    { "id": "timeline", "description": "Learn Timeline", "required": false }
  ]
}
```

### Mixed Required and Optional

Combine required core tasks with optional enhancement tasks:

```json
{
  "type": "loose",
  "tasks": [
    { "id": "main_request", "description": "Understand Request", "required": true },
    { "id": "preferences", "description": "Gather Preferences", "required": false },
    { "id": "feedback", "description": "Collect Feedback", "required": false }
  ]
}
```

## Next Steps

- [Deliverables](/docs/plan-structure/deliverables) — Configure data collection specifications
- [Examples](/docs/plan-structure/examples) — See complete plan examples
