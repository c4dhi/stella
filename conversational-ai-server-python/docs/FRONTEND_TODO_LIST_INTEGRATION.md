# Frontend Todo List Integration Guide

## Overview

This document explains how the conversational AI server communicates state machine progress to the frontend through LiveKit data channels, enabling real-time tracking of states, tasks, and deliverables.

## Key Features

- **State Machine Architecture**: Uses states containing tasks with deliverables instead of simple steps
- **First Message Activation**: State machine automatically initializes when user sends first message
- **Complete State Transmission**: Full state list with tasks and deliverables sent for comprehensive frontend management
- **Turn-Based Updates**: State data updated and re-sent after every user interaction
- **Real-Time Progress**: Immediate updates when states advance or deliverables are completed
- **STRICT vs LOOSE Modes**: States can process tasks sequentially (STRICT) or in parallel (LOOSE)

## Message Types

### 1. Primary Todo List Message: `complete_todo_list`

**When Sent:**
- First user message (trigger: `"first_message_plan_start"`)
- After every turn completion (trigger: `"safe_route_completed"` or `"unsafe_route_completed"`)
- When states advance (trigger: `"state_transition"`)
- After expert analysis (trigger: `"aggregator_step_advanced"`)
- During intelligent step chaining (trigger: `"intelligent_step_chaining_by_input_gate"`)

**Message Structure:**
```json
{
  "type": "complete_todo_list",
  "data": {
    "conversation_id": "conv_1704067200",
    "update_trigger": "first_message_plan_start",
    "participant_id": "task-manager",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "stream_id": "todo-list-stream",
    "todo_list": {
      "initialized": true,
      "first_state_activated_at": "2024-01-01T00:00:00.000Z",
      "total_states": 3,
      "current_state_index": 1,
      "completed_states": 0,
      "remaining_states": 3,
      "progress_percentage": 0.0,
      "current_state": {
        "id": "greeting",
        "title": "Grace Greeting",
        "type": "strict",
        "description": "Initial greeting and introduction",
        "status": "in_progress",
        "state_number": 1,
        "is_complete": false,
        "processing_mode": "strict"
      },
      "current_task": {
        "id": "greeting_task",
        "description": "Greet the user warmly and introduce Grace",
        "instruction": "Provide a friendly greeting",
        "required": true,
        "status": "in_progress"
      },
      "states": [
        {
          "id": "greeting",
          "title": "Grace Greeting",
          "type": "strict",
          "description": "Initial greeting and introduction",
          "status": "in_progress",
          "is_current": true,
          "completed_at": null,
          "tasks": [
            {
              "id": "greeting_task",
              "description": "Greet the user warmly and introduce Grace",
              "instruction": "Provide a friendly greeting",
              "required": true,
              "status": "in_progress",
              "deliverables": [
                {
                  "key": "user_name",
                  "description": "User's name for personalization",
                  "type": "string",
                  "required": false,
                  "status": "pending",
                  "value": null,
                  "collected_at": null,
                  "confidence": 0.0,
                  "reasoning": null,
                  "acceptance_criteria": ["Must be a non-empty string"]
                }
              ]
            }
          ]
        },
        {
          "id": "cognitive_exercise",
          "title": "Cognitive Stimulation",
          "type": "loose",
          "description": "Engage user in cognitive stimulation activities",
          "status": "pending",
          "is_current": false,
          "completed_at": null,
          "tasks": [
            {
              "id": "memory_exercise",
              "description": "Guide memory enhancement exercise",
              "instruction": "Lead user through memory exercises",
              "required": true,
              "status": "pending",
              "deliverables": [
                {
                  "key": "exercise_completion",
                  "description": "Confirmation of exercise completion",
                  "type": "boolean",
                  "required": true,
                  "status": "pending",
                  "value": null,
                  "collected_at": null,
                  "confidence": 0.0,
                  "reasoning": null,
                  "acceptance_criteria": ["User must indicate completion"]
                }
              ]
            },
            {
              "id": "optional_challenge",
              "description": "Optional advanced challenge",
              "instruction": "Offer optional challenge if user wants to continue",
              "required": false,
              "status": "skipped",
              "deliverables": [
                {
                  "key": "challenge_completion",
                  "description": "Completion of advanced challenge",
                  "type": "boolean",
                  "required": false,
                  "status": "skipped",
                  "value": null,
                  "collected_at": null,
                  "confidence": 0.0,
                  "reasoning": null,
                  "acceptance_criteria": ["User completes challenge"]
                }
              ]
            }
          ]
        }
        // ... additional states
      ],
      "tasks_summary": {
        "total_tasks": 3,
        "completed_tasks": 0,
        "pending_tasks": 3
      },
      "conversation_age_minutes": 0.1,
      "last_updated": "2024-01-01T00:00:00.000Z"
    },
    "all_deliverable_states": {
      "greeting": {
        "state_title": "Grace Greeting",
        "deliverables": {
          "user_name": {
            "key": "user_name",
            "description": "User's name for personalization",
            "type": "string",
            "required": false,
            "status": "pending",
            "value": null,
            "collected_at": null,
            "confidence": 0.0,
            "reasoning": null
          }
        }
      }
    },
    "remaining_states_count": 3,
    "context": {
      "todo_list_initialized": true,
      "first_state_activated_at": "2024-01-01T00:00:00.000Z",
      "plan_id": "cognitive_stimulation_demo_sm",
      "plan_title": "GRACE Cognitive Stimulation Exercise (State Machine)",
      "current_processing_mode": "strict"
    },
    "metadata": {
      "created_at": "2024-01-01T00:00:00.000Z",
      "state_order": ["greeting", "cognitive_exercise", "follow_up"],
      "architecture": "state_machine",
      "states_count": 3,
      "tasks_count": 4,
      "deliverables_count": 8
    }
  }
}
```

### 2. Plan Progress Update Message: `plan_progress_update`

**When Sent:**
- Immediately after `complete_todo_list` messages for state machine mode
- Provides formatted progress data optimized for frontend display

**Message Structure:**
```json
{
  "type": "plan_progress_update",
  "data": {
    "session_id": "conv_1704067200",
    "progress": {
      "percentage": 33.3,
      "state": "Grace Greeting",
      "mode": "strict",
      "state_id": "greeting",
      "description": "Initial greeting and introduction",
      "total_states": 3,
      "completed_states": 1,
      "current_state_index": 2
    },
    "current_step": {
      "id": "greeting",
      "title": "Grace Greeting",
      "type": "strict",
      "description": "Initial greeting and introduction",
      "is_complete": false
    },
    "deliverables": {
      "total": 8,
      "completed": 2,
      "pending": 6
    },
    "participant_id": "plan-service",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "stream_id": "plan-progress-stream"
  }
}
```

### 3. Real-Time Deliverable Updates: `plan_deliverable_update`

**When Sent:**
- Immediately when deliverables are detected/completed
- Provides specific deliverable value and reasoning

**Message Structure:**
```json
{
  "type": "plan_deliverable_update",
  "data": {
    "session_id": "conv_1704067200",
    "deliverable_key": "user_name",
    "deliverable_value": "Alice",
    "step_id": "greeting",
    "reasoning": "User introduced themselves as Alice",
    "participant_id": "plan-service",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "stream_id": "plan-stream"
  }
}
```

### 4. Legacy Support Messages

These continue to work for specific updates but are supplemented by the complete todo list:

**`task_progress_update`** - Quick progress updates from components
**`step_change_notification`** - Step transition alerts
**`task_update`** - Individual task lifecycle events

## Frontend Implementation

### 1. Message Listener Setup

```javascript
// LiveKit room setup
room.on(RoomEvent.DataReceived, (payload, participant) => {
  try {
    const message = JSON.parse(new TextDecoder().decode(payload));
    handleServerMessage(message);
  } catch (error) {
    console.error('Failed to parse message:', error);
  }
});

function handleServerMessage(message) {
  switch (message.type) {
    case 'complete_todo_list':
      handleCompleteTodoList(message.data);
      break;
    case 'plan_progress_update':
      handlePlanProgressUpdate(message.data);
      break;
    case 'plan_deliverable_update':
      handleDeliverableUpdate(message.data);
      break;
    case 'task_progress_update':
      handleTaskProgressUpdate(message.data);
      break;
    case 'step_change_notification':
      handleStepChange(message.data);
      break;
    // ... other message types
  }
}
```

### 2. State Management

```javascript
// Recommended state structure for state machine
const stateMachineState = {
  isInitialized: false,
  conversationId: null,
  planId: null,
  planTitle: null,
  currentState: null,
  currentTask: null,
  states: [],
  deliverables: {},
  progress: {
    totalStates: 0,
    currentStateIndex: 0,
    completedStates: 0,
    percentage: 0
  },
  tasks: {
    totalTasks: 0,
    completedTasks: 0,
    pendingTasks: 0,
    availableTasks: 0
  },
  lastUpdated: null,
  updateTrigger: null,
  processingMode: 'unknown' // 'strict' or 'loose'
};

function handleCompleteTodoList(data) {
  const todoList = data.todo_list;

  // Update complete state machine state
  stateMachineState.isInitialized = todoList.initialized;
  stateMachineState.conversationId = data.conversation_id;
  stateMachineState.planId = data.context?.plan_id;
  stateMachineState.planTitle = data.context?.plan_title;
  stateMachineState.currentState = todoList.current_state;
  stateMachineState.currentTask = todoList.current_task;
  stateMachineState.states = todoList.states;
  stateMachineState.deliverables = data.all_deliverable_states || {};
  stateMachineState.progress = {
    totalStates: todoList.total_states,
    currentStateIndex: todoList.current_state_index,
    completedStates: todoList.completed_states,
    percentage: todoList.progress_percentage
  };
  stateMachineState.tasks = todoList.tasks_summary;
  stateMachineState.lastUpdated = todoList.last_updated;
  stateMachineState.updateTrigger = data.update_trigger;
  stateMachineState.processingMode = todoList.current_state?.processing_mode || 'unknown';

  // Trigger UI update
  updateStateMachineUI();

  // Log for debugging
  console.log(`📋 [TASK] Todo list update received:`, {
    trigger: data.update_trigger,
    states: todoList.states?.length || 0,
    current_state: todoList.current_state?.title,
    processing_mode: stateMachineState.processingMode
  });
}

function handlePlanProgressUpdate(data) {
  const progress = data.progress;

  // Log progress update for debugging (matches your frontend logs)
  console.log(`📊 [TASK] Plan progress update:`, {
    percentage: progress.percentage,
    state: progress.state,
    mode: progress.mode
  });

  // Update UI with progress data
  updateProgressDisplay(progress);
}

function handleDeliverableUpdate(data) {
  // Real-time deliverable updates
  console.log(`📦 [DELIVERABLE] ${data.deliverable_key}: ${data.deliverable_value}`);
  if (data.reasoning) {
    console.log(`   Reasoning: ${data.reasoning}`);
  }

  // Update deliverable in state
  updateDeliverableInState(data.step_id, data.deliverable_key, {
    value: data.deliverable_value,
    reasoning: data.reasoning,
    collected_at: data.timestamp
  });
}
```

### 3. UI Components

```jsx
// React component example for state machine
function StateMachineProgress({ stateMachineState }) {
  const { currentState, currentTask, progress, states, tasks, processingMode } = stateMachineState;

  return (
    <div className="state-machine-container">
      {/* Progress Bar */}
      <div className="progress-section">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
        <span className="progress-text">
          State {progress.currentStateIndex} of {progress.totalStates}
          ({progress.percentage.toFixed(1)}% complete)
        </span>
      </div>

      {/* Current State */}
      <div className="current-state">
        <h3>{currentState?.title}</h3>
        <p>{currentState?.description}</p>
        <div className="state-meta">
          <span className={`status ${currentState?.status}`}>
            {currentState?.status?.replace('_', ' ').toUpperCase()}
          </span>
          <span className={`processing-mode ${processingMode}`}>
            {processingMode.toUpperCase()} MODE
          </span>
        </div>
      </div>

      {/* Current Task */}
      {currentTask && (
        <div className="current-task">
          <h4>Current Task: {currentTask.description}</h4>
          <p>{currentTask.instruction}</p>
          <span className={`task-status ${currentTask.status}`}>
            {currentTask.status?.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      )}

      {/* States List */}
      <div className="states-list">
        {states.map((state, index) => (
          <StateItem
            key={state.id}
            state={state}
            isActive={state.is_current}
            stateNumber={index + 1}
          />
        ))}
      </div>

      {/* Tasks Summary */}
      <div className="tasks-summary">
        <span>Tasks: {tasks.completedTasks}/{tasks.totalTasks} completed</span>
        <span>Available: {tasks.availableTasks}</span>
      </div>
    </div>
  );
}

function StateItem({ state, isActive, stateNumber }) {
  return (
    <div className={`state-item ${isActive ? 'active' : ''} ${state.status} ${state.type}`}>
      <div className="state-header">
        <div className="state-number">{stateNumber}</div>
        <div className="state-info">
          <h4>{state.title}</h4>
          <span className="state-type">{state.type.toUpperCase()}</span>
        </div>
      </div>
      <div className="state-content">
        <p>{state.description}</p>
        {state.tasks.length > 0 && (
          <div className="state-tasks">
            {state.tasks.map(task => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskItem({ task }) {
  return (
    <div className={`task ${task.status}`}>
      <h5 className={task.status === 'skipped' ? 'line-through' : ''}>
        {task.description}
        {task.status === 'skipped' && <span className="badge skipped-badge">Skipped</span>}
      </h5>
      <p>{task.instruction}</p>
      {task.deliverables.length > 0 && (
        <div className="task-deliverables">
          <h6>Deliverables:</h6>
          {task.deliverables.map(deliverable => (
            <div key={deliverable.key} className={`deliverable ${deliverable.status}`}>
              <span className="deliverable-key">{deliverable.key}:</span>
              <span className="deliverable-description">{deliverable.description}</span>
              {deliverable.value && (
                <span className="deliverable-value">= {deliverable.value}</span>
              )}
              {deliverable.status === 'skipped' && <span className="skipped-indicator">(skipped)</span>}
              {deliverable.required && <span className="required">*</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 4. Update Triggers

Frontend should handle these update triggers appropriately:

- **`"first_message_plan_start"`** - Initialize UI, show state machine welcome
- **`"safe_route_completed"`** - Simple interaction completed, update state
- **`"unsafe_route_completed"`** - Complex analysis completed, show expert results
- **`"state_transition"`** - Animate state transition, update current state
- **`"intelligent_step_chaining_by_input_gate"`** - Multiple states processed, show chain
- **`"aggregator_step_advanced"`** - Show expert analysis results

## Data Flow Timeline

```
User sends first message →
1. Server detects first interaction
2. Initializes state machine (first state = "in_progress")
3. Sends complete_todo_list with trigger "first_message_plan_start"
4. Sends plan_progress_update with formatted progress data
5. Frontend shows initialized state machine

Each subsequent turn →
1. Server processes message (InputGate + State Machine + maybe Aggregator)
2. State machine detects deliverables and updates task states
3. Real-time plan_deliverable_update messages sent as deliverables detected
4. Server sends complete_todo_list with trigger "safe_route_completed" or "unsafe_route_completed"
5. Server sends plan_progress_update with current progress
6. Frontend updates state display

State transitions →
1. State machine evaluates transition conditions
2. Advances to next state automatically
3. Immediate complete_todo_list with trigger "state_transition"
4. Plan progress update with new state info
5. Frontend animates state transitions

Deliverable detection →
1. User message contains deliverable information
2. Immediate plan_deliverable_update sent with value and reasoning
3. State machine updates internal deliverable state
4. Turn completion sends updated complete state
```

## Error Handling

```javascript
function handleCompleteTodoList(data) {
  try {
    // Validate required fields for state machine
    if (!data.todo_list || !data.conversation_id) {
      console.warn('Invalid state machine data received:', data);
      return;
    }

    // Validate state machine structure
    if (!data.todo_list.states || !Array.isArray(data.todo_list.states)) {
      console.warn('Invalid states array in todo list data:', data);
      return;
    }

    // Check for conversation mismatch
    if (stateMachineState.conversationId &&
        stateMachineState.conversationId !== data.conversation_id) {
      console.warn('Conversation ID mismatch - new conversation started');
      resetStateMachineState();
    }

    // Check for architecture mismatch
    if (data.metadata?.architecture !== 'state_machine') {
      console.warn('Expected state machine architecture, got:', data.metadata?.architecture);
    }

    // Update state machine state
    updateStateMachineState(data);

  } catch (error) {
    console.error('Error handling state machine update:', error);
  }
}
```

## Debugging

**Console Logging:**
- Server logs show todo list initialization and updates
- Look for `[MessageProcessor]` and `[TaskManager]` prefixes

**Message Inspection:**
```javascript
// Log all todo list messages for debugging
function handleCompleteTodoList(data) {
  console.group('Todo List Update');
  console.log('Trigger:', data.update_trigger);
  console.log('Current Step:', data.todo_list.current_step);
  console.log('Progress:', data.todo_list.progress_percentage + '%');
  console.log('Tasks:', data.todo_list.tasks_summary);
  console.groupEnd();
}
```

## State Machine Concepts

### State Types
- **STRICT States**: Tasks are processed sequentially, one at a time. Only the current task is available.
- **LOOSE States**: Multiple tasks can be processed in parallel. All incomplete tasks are available.

### Task Processing
- **Tasks** contain **Deliverables** that need to be collected
- **Deliverables** have types (string, boolean, number, etc.) and acceptance criteria
- State machine automatically detects deliverables in user messages
- Tasks complete when all required deliverables are collected
- Tasks can be **skipped** based on user choices (e.g., declining continuation)
- States complete when all required tasks are finished (completed or skipped)

### State Transitions
- States advance automatically when completion conditions are met
- Transitions have conditions and priorities
- Frontend receives updates during transitions

## Task Status Values

Tasks can have the following status values:

- **`"pending"`** - Task has not been started yet
- **`"in_progress"`** - Task is currently being worked on (current task in STRICT mode)
- **`"completed"`** - Task has been successfully completed with all required deliverables
- **`"skipped"`** - Task was skipped based on user choice or system logic (e.g., declining continuation)

### Handling Skipped Tasks

When a task is marked as `"skipped"`:
- It is treated as complete for state progression purposes
- Only **required tasks** need to be completed or skipped for state to advance
- Optional tasks can remain skipped without blocking progression
- Skipped tasks do NOT have a `completed_at` timestamp
- Frontend should display skipped tasks differently (e.g., greyed out, strikethrough)

### Example: Continuation Check Flow

```javascript
// User is asked if they want to continue after completing level 4
// Task: check_continuation with deliverable: wants_to_continue (boolean)

// Scenario 1: User says "No, let's stop here"
// Result:
// - wants_to_continue = false
// - System automatically marks levels 5, 6, 7 as "skipped"
// - State is complete (all required tasks done)
// - Transitions to next state (feedback_and_closure)

// Scenario 2: User says "Yes, let's continue"
// Result:
// - wants_to_continue = true
// - Levels 5, 6, 7 remain available
// - User can proceed with additional levels
```

## Best Practices

1. **Always use `complete_todo_list`** for authoritative state - it contains complete state machine information
2. **Use `plan_progress_update`** for quick UI updates with formatted data
3. **Handle `plan_deliverable_update`** for real-time deliverable feedback
4. **Validate state machine structure** before updating UI state
5. **Display both current state and current task** information
6. **Show processing mode (STRICT/LOOSE)** to help users understand behavior
7. **Handle deliverable updates** to show real-time progress
8. **Cache previous state** for smooth transitions and error recovery
9. **Show loading states** during state transitions
10. **Persist state** locally for page refresh recovery
11. **Display skipped tasks distinctly** - Use visual indicators like strikethrough, greyed text, or "Skipped" badges
12. **Count skipped tasks toward completion** - Skipped tasks contribute to state completion percentage

## Migration from Legacy System

If migrating from the old step-based system:

1. **Update data structure expectations**: Change from `steps` to `states`, `current_step` to `current_state`
2. **Add state machine message handlers**: `plan_progress_update`, `plan_deliverable_update`
3. **Handle task/deliverable hierarchy**: States contain tasks which contain deliverables
4. **Support processing modes**: Display STRICT vs LOOSE mode indicators
5. **Keep legacy listeners** for backwards compatibility during transition
6. **Test with state machine plans** to ensure proper data handling

## Key Changes from Legacy

| Legacy (Steps) | State Machine | Notes |
|----------------|---------------|-------|
| `steps[]` | `states[]` | States contain tasks with deliverables |
| `current_step` | `current_state` | Current state has type and processing mode |
| `step_change` | `state_transition` | States advance based on task completion |
| Manual task creation | Automatic deliverable detection | System detects deliverables in messages |
| Linear progression | Conditional transitions | States can branch based on conditions |

This implementation provides a robust, real-time state machine system that keeps the frontend perfectly synchronized with the server's conversational AI state, supporting complex task hierarchies and flexible processing modes.