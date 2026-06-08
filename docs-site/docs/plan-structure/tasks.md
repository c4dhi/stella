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
- `false`: The agent **may** skip the task — but it still has to be *addressed*. An optional task that is never collected **and** never skipped will keep the state from transitioning; `required: false` means "the agent is allowed to skip it", not "ignored automatically".

### `deliverables`

An array of specific pieces of information to collect during this task. See [Deliverables](./deliverables.md) for full details.

## Task Completion

A task becomes **addressed** (so it no longer blocks the state) in one of these ways:

1. **Deliverable-driven (automatic).** A task that owns deliverables is completed automatically once its data is in — the agent does **not** need a separate completion call:
   - if it has at least one **required** deliverable, once all of its required deliverables are collected (optional ones never block);
   - if **all** of its deliverables are optional, once **every** declared deliverable has been collected.
2. **Explicit completion/skip.** The agent can always explicitly mark a task complete or skip it. A task with **no deliverables** has no data to gate on, so it *must* be completed or skipped explicitly — it is never auto-completed.

Completion is intentionally derived from collected data wherever possible, rather than relying on the agent to remember a second "mark complete" step after collecting the answer.

A state's `all_tasks_complete` transition fires only once **every** task in the state — required *and* optional — has been addressed (completed or skipped). Note that a freshly entered state is never "vacuously" complete: a task with nothing collected and no explicit skip stays pending. When a task is skipped, its still-uncollected deliverables are reported as `skipped` too.

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

- [Deliverables](./deliverables.md) — Configure data collection specifications
- [Examples](./examples.md) — See complete plan examples
