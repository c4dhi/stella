---
sidebar_position: 2
title: "Plan Builder"
---

# Plan Builder

The Plan Builder is a visual canvas for designing conversation flow as connected states. It stores layout and connection metadata, but the saved plan remains standard plan JSON.

## Canvas Overview

The canvas uses a node-and-edge graph:

- **Nodes** represent conversation control points (`Start`, `State`, `End`)
- **Edges** represent transitions between states
- **Sidebar editors** configure the selected node or edge

Core interactions:

- Click a node to edit it
- Drag from one node handle to another to create an edge
- Click an edge label to edit condition and priority
- Drag nodes to save their canvas positions

## Node Types

### Start Node

The Start node is fixed on the left side of the canvas and is always present.

It configures:

- `initial_state_id` (which state starts first)
- `agent_spawn_mode` (`immediate` or `on_demand`)
- `session_context.fields` (pre-session data collection fields)

### State Nodes

State nodes represent executable plan states.

Each state node can be connected to:

- Other state nodes (normal transitions)
- The End node (conversation termination path)

State node cards display:

- State order number (derived from graph order)
- State title
- Task count

### End Node

The End node is optional and can be toggled on or off in the builder.

When enabled, connecting a state to End adds that state ID to:

```json
{
  "metadata": {
    "plan_builder": {
      "canvas": {
        "end_state_ids": ["state_a", "state_b"]
      }
    }
  }
}
```

## Edge Configuration

Selecting an edge opens transition configuration for the source → target pair.

## Transition Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `target_state_id` | `string` | Yes | State to transition to |
| `condition_type` | `string` | Yes | Condition evaluated each turn |
| `condition_config` | `object` | Depends | Parameters for conditional checks |
| `priority` | `number` | No | Lower number runs first |

## Condition Types in the Builder UI

The current visual editor supports:

- `all_tasks_complete`
- `deliverable_exists`
- `deliverable_value`

### `all_tasks_complete`

Transitions when required tasks in the current state are complete.

```json
{
  "target_state_id": "review",
  "condition_type": "all_tasks_complete",
  "priority": 1
}
```

### `deliverable_exists`

Transitions when a deliverable key is present.

```json
{
  "target_state_id": "needs_followup",
  "condition_type": "deliverable_exists",
  "priority": 1,
  "condition_config": {
    "key": "callback_requested"
  }
}
```

### `deliverable_value`

Transitions when a deliverable key matches an expected value.

```json
{
  "target_state_id": "premium_flow",
  "condition_type": "deliverable_value",
  "priority": 1,
  "condition_config": {
    "key": "membership_type",
    "value": "premium"
  }
}
```

## Priority and Route Selection

When multiple transitions are true, the transition with the lowest `priority` value wins.

Use explicit priority spacing for readability (for example `1`, `10`, `20`) to keep room for future routes.

## Builder Validation Rules

Before saving:

- Start must point to a valid state (`initial_state_id`)
- Transition conditions cannot be incomplete
- Duplicate outgoing conditions from the same source state are flagged as ambiguous

The builder also warns when states have no outgoing transitions and are not connected to End.

## JSON Mapping

The builder stores both execution data and canvas metadata.

Execution-level fields:

- `states`
- `initial_state_id`
- `session_context`
- `system_prompt`

Canvas metadata fields:

```json
{
  "metadata": {
    "plan_builder": {
      "start": {
        "agent_spawn_mode": "immediate"
      },
      "canvas": {
        "state_positions": {
          "state_1": { "x": 420, "y": 180 }
        },
        "show_end_node": true,
        "end_node_position": { "x": 1200, "y": 220 },
        "end_state_ids": ["state_3"]
      }
    }
  }
}
```

## Next Steps

- [States](/docs/plan-structure/states) — Configure state execution modes and transitions
- [Tasks](/docs/plan-structure/tasks) — Define task instructions and required work
- [Deliverables](/docs/plan-structure/deliverables) — Define what data each task must collect
