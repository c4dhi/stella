# Task List & Deliverables Frontend Integration Guide

## Overview

This document provides comprehensive guidance for frontend developers to implement a real-time task display that shows conversation progress and automatically updates as deliverables are collected. The system uses WebRTC data channels via LiveKit for bidirectional communication between the Python backend and React frontend.

## Architecture

```
Backend (Python)                    Frontend (React)
┌─────────────────────┐            ┌─────────────────────┐
│  TaskManager        │            │  Task Display UI    │
│  - State Machine    │            │  - Progress Bar     │
│  - State Management │◄──────────►│  - State List       │
│  - Task Execution   │  WebRTC    │  - Task View        │
│  - Deliverables     │  DataChannel│  - Deliverable View │
│                     │            │                     │
│  StreamService      │            │  Message Handler    │
│  - Send Updates     │            │  - Parse Messages   │
│  - JSON Messages    │            │  - Update State     │
└─────────────────────┘            └─────────────────────┘
```

## Core Data Structures

### 1. Plan Structure

```typescript
interface Plan {
  id: string;                    // e.g., "cognitive_stimulation_demo_sm"
  title: string;                 // e.g., "GRACE Cognitive Exercise"
  description: string;
  initial_state_id: string;      // First state to execute
  states: State[];
  metadata: {
    architecture: "state_machine";
    states_count: number;
    tasks_count: number;
    deliverables_count: number;
  };
}

interface State {
  id: string;                    // e.g., "introduction", "memory_game"
  title: string;                 // e.g., "Introduction and Getting to Know You"
  type: StateType;               // "strict" or "loose"
  description: string;           // State purpose and behavior
  tasks: Task[];                 // Tasks within this state
  transitions: StateTransition[]; // How to move to next state
}

interface Task {
  id: string;                    // e.g., "collect_name", "memory_level_1"
  description: string;           // What this task accomplishes
  instruction: string;           // AI instruction for this task
  required: boolean;             // Must be completed vs optional
  deliverables: Deliverable[];   // Information to collect
  dependencies?: string[];       // Other tasks that must complete first
  status: TaskStatus;            // Current execution status
}

enum StateType {
  STRICT = "strict",    // Sequential task processing
  LOOSE = "loose"       // Flexible task processing
}

enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  SKIPPED = "skipped"
}

interface StateTransition {
  target_state_id: string;
  condition_type: string;        // e.g., "all_tasks_complete"
  condition_data?: any;          // Additional condition parameters
  priority: number;              // Transition priority (higher first)
}
```

### 2. Deliverable Structure

```typescript
interface Deliverable {
  key: string;                   // e.g., "user_name"
  type: "string" | "enum" | "boolean" | "number";
  description: string;           // e.g., "User's preferred name"
  required: boolean;
  enum_values?: string[];        // For enum type
  validation_pattern?: string;   // Regex pattern
  acceptance_criteria?: string;  // Validation rules
}

interface DeliverableState {
  deliverable: Deliverable;
  status: "pending" | "partial" | "completed" | "skipped";
  value: any;                    // Collected value
  collected_at: string;          // ISO timestamp
  source_message: string;        // User message that provided it
  confidence: number;            // 0.0 to 1.0
  reasoning: string;             // LLM explanation for why acceptance criteria was met
}
```

### 3. Status Structures

```typescript
interface TaskStatus {
  PENDING: "pending";
  IN_PROGRESS: "in_progress";
  COMPLETED: "completed";
  SKIPPED: "skipped";
}

interface StateStatus {
  PENDING: "pending";
  IN_PROGRESS: "in_progress";
  COMPLETED: "completed";
}

interface DeliverableStatus {
  PENDING: "pending";
  PARTIAL: "partial";
  COMPLETED: "completed";
  SKIPPED: "skipped";
}
```

## Message Types & Payloads

### 1. Complete Todo List Update

**Most comprehensive update - contains full state with enhanced deliverable tracking**

```javascript
// Message Type: "complete_todo_list"
{
  "type": "complete_todo_list",
  "data": {
    "conversation_id": "conv_1234567890",
    "todo_list": {
      "initialized": true,
      "first_state_activated_at": "2024-01-20T10:30:00Z",
      "total_states": 3,
      "current_state_index": 2,
      "completed_states": 1,
      "remaining_states": 2,
      "progress_percentage": 33.3,
      "current_state": {
        "id": "memory_game",
        "title": "Progressive Memory Challenge",
        "type": "strict",
        "description": "Sequential memory game with increasing difficulty",
        "status": "in_progress",
        "state_number": 2,
        "is_complete": false
      },
      "current_task": {
        "id": "memory_level_3",
        "description": "Shopping List Game - Level 3 (3 items)",
        "instruction": "Continue building the list to three items: milk, bread, eggs",
        "required": true,
        "status": "in_progress"
      },
      "states": [
        {
          "id": "introduction",
          "title": "Introduction and Getting to Know You",
          "type": "loose",
          "description": "Warmly introduce and collect user information",
          "status": "completed",
          "is_current": false,
          "completed_at": "2024-01-20T10:32:00Z",
          "tasks": [
            {
              "id": "collect_name",
              "description": "Learn the user's name",
              "instruction": "Introduce yourself as GRACE warmly and learn the user's name",
              "required": true,
              "status": "completed",
              "deliverables": [
                {
                  "key": "user_name",
                  "description": "The user's name",
                  "type": "string",
                  "required": true,
                  "status": "completed",
                  "value": "Sarah",
                  "collected_at": "2024-01-20T10:31:00Z",
                  "confidence": 0.95,
                  "reasoning": "User clearly stated 'Hi, I'm Sarah' which satisfies the acceptance criteria."
                }
              ]
            },
            {
              "id": "collect_age",
              "description": "Find out the user's age",
              "instruction": "Find out their age naturally as part of the conversation",
              "required": true,
              "status": "completed",
              "deliverables": [
                {
                  "key": "user_age",
                  "description": "The user's age",
                  "type": "number",
                  "required": true,
                  "status": "completed",
                  "value": 34,
                  "collected_at": "2024-01-20T10:31:30Z",
                  "confidence": 0.92,
                  "reasoning": "User mentioned 'I'm 34 years old' which clearly provides their age."
                }
              ]
            }
            // ... other introduction tasks
          ]
        },
        {
          "id": "memory_game",
          "title": "Progressive Memory Challenge",
          "type": "strict",
          "description": "Sequential shopping list memory game",
          "status": "in_progress",
          "is_current": true,
          "tasks": [
            {
              "id": "memory_level_1",
              "description": "Shopping List Game - Level 1 (1 item)",
              "instruction": "Start simple with just 'milk' to build confidence",
              "required": true,
              "status": "completed",
              "deliverables": [
                {
                  "key": "shopping_list_1",
                  "description": "User's attempt at the shopping list",
                  "type": "string",
                  "required": true,
                  "status": "completed",
                  "value": "milk",
                  "collected_at": "2024-01-20T10:33:00Z",
                  "confidence": 1.0,
                  "reasoning": "User correctly repeated 'milk' as requested."
                }
              ]
            },
            {
              "id": "memory_level_2",
              "description": "Shopping List Game - Level 2 (2 items)",
              "instruction": "Increase difficulty to milk and bread",
              "required": true,
              "status": "completed",
              "deliverables": [
                {
                  "key": "shopping_list_2",
                  "description": "User's attempt at the shopping list",
                  "type": "string",
                  "required": true,
                  "status": "completed",
                  "value": "milk, bread",
                  "collected_at": "2024-01-20T10:33:30Z",
                  "confidence": 1.0,
                  "reasoning": "User correctly listed both 'milk' and 'bread' in order."
                }
              ]
            },
            {
              "id": "memory_level_3",
              "description": "Shopping List Game - Level 3 (3 items)",
              "instruction": "Continue building the list to three items: milk, bread, eggs",
              "required": true,
              "status": "in_progress",
              "deliverables": [
                {
                  "key": "shopping_list_3",
                  "description": "User's attempt at the shopping list",
                  "type": "string",
                  "required": true,
                  "status": "pending",
                  "value": null,
                  "collected_at": null,
                  "confidence": 0.0,
                  "reasoning": null
                }
              ]
            }
            // ... remaining memory levels
          ]
        }
        // ... feedback_and_closure state
      ],
      "tasks_summary": {
        "total_tasks": 17,
        "completed_tasks": 7,
        "pending_tasks": 10,
        "current_tasks": 1
      },
      "conversation_age_minutes": 5.2,
      "last_updated": "2024-01-20T10:35:00Z"
    },
    "all_deliverable_states": {
      "introduction": {
        "state_title": "Introduction and Getting to Know You",
        "deliverables": {
          "user_name": {
            "description": "The user's name",
            "type": "string",
            "required": true,
            "status": "completed",
            "value": "Sarah",
            "collected_at": "2024-01-20T10:31:00Z",
            "confidence": 0.95,
            "reasoning": "User clearly stated 'Hi, I'm Sarah' which satisfies the acceptance criteria.",
            "acceptance_criteria": "Should be the name the user prefers to be called."
          },
          "user_age": {
            "description": "The user's age",
            "type": "number",
            "required": true,
            "status": "completed",
            "value": 34,
            "collected_at": "2024-01-20T10:31:30Z",
            "confidence": 0.92,
            "reasoning": "User mentioned 'I'm 34 years old' which clearly provides their age.",
            "acceptance_criteria": "Should be a reasonable age between 1 and 120."
          }
        }
      },
      "memory_game": {
        "state_title": "Progressive Memory Challenge",
        "deliverables": {
          "shopping_list_1": {
            "description": "User's attempt at the shopping list (1 item)",
            "type": "string",
            "required": true,
            "status": "completed",
            "value": "milk",
            "collected_at": "2024-01-20T10:33:00Z",
            "confidence": 1.0,
            "reasoning": "User correctly repeated 'milk' as requested.",
            "acceptance_criteria": "Should contain the word 'milk'."
          },
          "shopping_list_2": {
            "description": "User's attempt at the shopping list (2 items)",
            "type": "string",
            "required": true,
            "status": "completed",
            "value": "milk, bread",
            "collected_at": "2024-01-20T10:33:30Z",
            "confidence": 1.0,
            "reasoning": "User correctly listed both 'milk' and 'bread' in order.",
            "acceptance_criteria": "Should contain both 'milk' and 'bread'."
          },
          "shopping_list_3": {
            "description": "User's attempt at the shopping list (3 items)",
            "type": "string",
            "required": true,
            "status": "pending",
            "value": null,
            "collected_at": null,
            "confidence": 0.0,
            "reasoning": null,
            "acceptance_criteria": "Should contain 'milk', 'bread', and 'eggs'."
          }
        }
      }
    },
    "remaining_states_count": 2,
    "context": {
      "plan_id": "cognitive_stimulation_demo_sm",
      "plan_title": "GRACE Cognitive Stimulation Exercise",
      "todo_list_initialized": true,
      "first_state_activated_at": "2024-01-20T10:30:00Z",
      "current_processing_mode": "strict"
    },
    "metadata": {
      "created_at": "2024-01-20T10:30:00Z",
      "state_order": ["introduction", "memory_game", "feedback_and_closure"],
      "architecture": "state_machine",
      "states_count": 3,
      "tasks_count": 17,
      "deliverables_count": 16
    },
    "update_trigger": "turn_completion",
    "participant_id": "task-manager",
    "timestamp": "2024-01-20T10:35:00Z",
    "stream_id": "todo-list-stream"
  }
}
```

### 2. Plan Progress Update

**Lightweight progress notification**

```javascript
// Message Type: "plan_progress_update"
{
  "type": "plan_progress_update",
  "data": {
    "session_id": "session_123",
    "progress": {
      "total_states": 5,
      "completed_states": 2,
      "current_state_index": 3,
      "percentage": 40.0
    },
    "current_state": {
      "id": "analysis",
      "title": "Analyzing Information",
      "type": "strict",
      "status": "in_progress"
    },
    "deliverables": {
      "user_name": {
        "description": "User's preferred name",
        "type": "string",
        "required": true,
        "status": "completed",
        "value": "John",
        "collected_at": "2024-01-20T10:32:00Z",
        "reasoning": "User explicitly stated 'My name is John' which clearly satisfies the acceptance criteria for a user's preferred name."
      },
      "user_age": {
        "description": "User's age",
        "type": "number",
        "required": false,
        "status": "pending",
        "value": null,
        "collected_at": null,
        "reasoning": null
      }
    },
    "participant_id": "plan-service",
    "timestamp": "2024-01-20T10:35:00Z",
    "stream_id": "plan-stream"
  }
}
```

### 3. Plan Deliverable Update

**Real-time deliverable collection notification with reasoning**

```javascript
// Message Type: "plan_deliverable_update"
{
  "type": "plan_deliverable_update",
  "data": {
    "session_id": "session_123",
    "deliverable_key": "user_name",
    "deliverable_value": "John",
    "state_id": "introduction",
    "reasoning": "User explicitly stated 'My name is John' which clearly satisfies the acceptance criteria for a user's preferred name.",
    "confidence": 0.95,
    "acceptance_criteria": "Should be the name the user prefers to be called.",
    "participant_id": "plan-service",
    "timestamp": "2024-01-20T10:32:00Z",
    "stream_id": "plan-stream"
  }
}
```

### 4. State Change Notification

**Triggered when conversation advances to new state**

```javascript
// Message Type: "state_change_notification"
{
  "type": "state_change_notification",
  "data": {
    "previous_state": "introduction",
    "current_state": "memory_game",
    "state_title": "Progressive Memory Challenge",
    "state_description": "Sequential memory game with increasing difficulty",
    "action_taken": "state_transition",
    "participant_id": "task-manager",
    "timestamp": "2024-01-20T10:31:00Z",
    "stream_id": "task-stream"
  }
}
```

### 5. Task Progress Update

**Detailed task and state progress**

```javascript
// Message Type: "task_progress_update"
{
  "type": "task_progress_update",
  "data": {
    "update_type": "plan_progress_update",
    "current_state": {
      "id": "memory_game",
      "title": "Progressive Memory Challenge",
      "status": "in_progress"
    },
    "current_task": {
      "id": "memory_level_3",
      "description": "Shopping List Game - Level 3",
      "status": "in_progress"
    },
    "progress": {
      "total_states": 3,
      "completed_states": 1,
      "percentage": 33.3
    },
    "tasks": {
      "total": 17,
      "completed": 7,
      "current": 1
    },
    "states": [...], // Array of state details
    "metadata": {
      "verdict": "safe",
      "intent": "provide_information",
      "state_changed": true,
      "states_processed": ["introduction", "memory_game"],
      "component": "input_gate_state_processing",
      "plan_id": "cognitive_stimulation_demo_sm",
      "deliverables_detected": 1,
      "deliverables_status": {...}
    },
    "participant_id": "task-manager",
    "timestamp": "2024-01-20T10:31:00Z",
    "stream_id": "task-stream"
  }
}
```

## Enhanced Deliverable Detection & Collection Flow

### 1. Detection Process

```
User Input → InputGate → LLM Analysis (with Context) → Reasoning-based Extraction → Validation → Storage → Frontend Update
```

1. **User provides information** (voice or text)
2. **InputGate processes message** with full context (current + remaining steps)
3. **LLM analyzes against acceptance criteria** and provides reasoning
4. **Validation occurs** including greeting detection prevention
5. **TaskManager stores** deliverable with confidence score and reasoning
6. **StreamService sends** real-time update with complete context to frontend

### 2. Enhanced Validation Rules

```python
# Enhanced backend validation logic
def validate_deliverable_with_reasoning(value, deliverable, reasoning, user_input):
    # Reject common greetings as deliverable values
    greeting_patterns = ['hi', 'hello', 'hey', 'good morning', 'howdy']
    if deliverable.key == 'user_name' and value.lower() in greeting_patterns:
        return False, "Greeting detected, not a name"

    # Require reasoning for LLM detections
    if not reasoning or reasoning.strip() == "":
        return False, "No reasoning provided for deliverable detection"

    # Check against acceptance criteria match
    if deliverable.acceptance_criteria:
        # LLM must explain how value meets criteria
        criteria_keywords = extract_criteria_keywords(deliverable.acceptance_criteria)
        if not any(keyword in reasoning.lower() for keyword in criteria_keywords):
            return False, "Reasoning doesn't address acceptance criteria"

    # Existing validations...
    return True, "Valid deliverable with proper reasoning"
```

### 3. Enhanced Confidence System

- **LLM with reasoning**: 0.95 confidence (when reasoning provided)
- **LLM without reasoning**: Rejected automatically
- **Greeting detection**: 0.0 confidence (blocked)
- **Pattern matching fallback**: 0.5-0.8 confidence
- **Required vs Optional**: Same thresholds, but reasoning required for both

## Frontend Implementation Guide

### 1. WebRTC Message Handler

```typescript
// React component for handling backend messages
import { useEffect, useState } from 'react';
import { Room, DataPacket_Kind } from 'livekit-client';

interface TaskDisplayProps {
  room: Room;
}

export function TaskDisplay({ room }: TaskDisplayProps) {
  const [todoList, setTodoList] = useState(null);
  const [deliverables, setDeliverables] = useState({});
  const [currentStep, setCurrentStep] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: any,
      kind?: DataPacket_Kind
    ) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));

        switch (message.type) {
          case 'complete_todo_list':
            handleCompleteTodoList(message.data);
            break;

          case 'plan_progress_update':
            handleProgressUpdate(message.data);
            break;

          case 'plan_deliverable_update':
            handleDeliverableUpdate(message.data);
            break;

          case 'state_change_notification':
            handleStateChange(message.data);
            break;

          case 'task_progress_update':
            handleTaskProgress(message.data);
            break;
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);

    return () => {
      room.off('dataReceived', handleDataReceived);
    };
  }, [room]);

  const handleCompleteTodoList = (data: any) => {
    setTodoList(data.todo_list);
    setProgress(data.todo_list.progress_percentage);

    // Set current state and task
    setCurrentState(data.todo_list.current_state);
    setCurrentTask(data.todo_list.current_task);
    setProcessingMode(data.context?.current_processing_mode || 'unknown');

    // Extract deliverables from all_deliverable_states
    if (data.all_deliverable_states) {
      updateStateBasedDeliverables(data.all_deliverable_states);
    }
  };

  const handleDeliverableUpdate = (data: any) => {
    setDeliverables(prev => ({
      ...prev,
      [data.deliverable_key]: {
        value: data.deliverable_value,
        collected_at: data.timestamp,
        state_id: data.state_id,
        reasoning: data.reasoning,
        confidence: data.confidence,
        acceptance_criteria: data.acceptance_criteria
      }
    }));

    // Show enhanced notification with reasoning
    showNotification(
      `Collected: ${data.deliverable_key}`,
      `Value: ${data.deliverable_value} (${data.confidence}% confidence)`,
      data.reasoning
    );
  };

  const updateStateBasedDeliverables = (allDeliverableStates: any) => {
    // Flatten all deliverables from all states into a single object
    const flattened = {};
    Object.entries(allDeliverableStates).forEach(([stateId, stateData]: [string, any]) => {
      Object.entries(stateData.deliverables || {}).forEach(([key, deliverable]) => {
        flattened[key] = {
          ...deliverable,
          state_id: stateId,
          state_title: stateData.state_title
        };
      });
    });
    setDeliverables(flattened);
  };

  // ... rest of handlers
}
```

### 2. Progress Display Component

```tsx
interface ProgressBarProps {
  progress: number;
  currentState: number;
  totalStates: number;
  currentTask?: any;
  processingMode?: string;
}

export function TaskProgressBar({
  progress,
  currentState,
  totalStates,
  currentTask,
  processingMode
}: ProgressBarProps) {
  const getProgressLabel = () => {
    const baseLabel = `State ${currentState} of ${totalStates}`;
    if (processingMode === 'strict' && currentTask) {
      return `${baseLabel} • Task: ${currentTask.description}`;
    }
    if (processingMode === 'loose') {
      return `${baseLabel} • Multiple Tasks Active`;
    }
    return baseLabel;
  };

  return (
    <div className="task-progress-container">
      <div className="progress-header">
        <span>{getProgressLabel()}</span>
        <span>{progress.toFixed(0)}% Complete</span>
      </div>
      {processingMode && (
        <div className="processing-mode">
          <span className={`mode-badge ${processingMode}`}>
            {processingMode === 'strict' ? '⚡ Sequential' : '🔄 Flexible'}
          </span>
        </div>
      )}
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
```

### 3. Deliverables Display Component

```tsx
interface DeliverablesViewProps {
  deliverables: Record<string, DeliverableState>;
  currentStepDeliverables: Deliverable[];
}

export function DeliverablesView({ deliverables, currentStepDeliverables }: DeliverablesViewProps) {
  return (
    <div className="deliverables-container">
      <h3>Information Collected</h3>
      {currentStepDeliverables.map(deliverable => {
        const state = deliverables[deliverable.key];
        return (
          <div key={deliverable.key} className="deliverable-item">
            <div className="deliverable-header">
              <span className="deliverable-label">
                {deliverable.description}
                {deliverable.required && <span className="required">*</span>}
              </span>
              <span className={`status ${state?.status || 'pending'}`}>
                {state?.status || 'pending'}
              </span>
            </div>
            {state?.value && (
              <div className="deliverable-value">
                <div className="value">{state.value}</div>
                {state.confidence && (
                  <div className="confidence">Confidence: {state.confidence}%</div>
                )}
                {state.reasoning && (
                  <div className="reasoning">Reasoning: {state.reasoning}</div>
                )}
                {state.acceptance_criteria && (
                  <div className="criteria">Criteria: {state.acceptance_criteria}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

### 4. State List Component

```tsx
interface StateListProps {
  states: Array<{
    id: string;
    title: string;
    type: 'strict' | 'loose';
    status: string;
    is_current: boolean;
    tasks?: Array<{
      id: string;
      description: string;
      required: boolean;
      status: string;
      deliverables?: Array<{
        key: string;
        description: string;
        required: boolean;
        status: string;
        value?: any;
        collected_at?: string;
        reasoning?: string;
        confidence?: number;
      }>;
    }>;
  }>;
}

export function StateList({ states }: StateListProps) {
  return (
    <div className="state-list">
      {states.map((state, index) => (
        <div
          key={state.id}
          className={`state-item ${state.status} ${state.is_current ? 'current' : ''}`}
        >
          <div className="state-number">{index + 1}</div>
          <div className="state-content">
            <div className="state-header">
              <div className="state-title">{state.title}</div>
              <span className={`state-type ${state.type}`}>
                {state.type === 'strict' ? '⚡' : '🔄'}
              </span>
            </div>
            <div className="state-status">{state.status}</div>

            {/* Show tasks for this state */}
            {state.tasks && state.tasks.length > 0 && (
              <div className="state-tasks">
                {state.tasks.map(task => (
                  <div
                    key={task.id}
                    className={`task ${task.status}`}
                  >
                    <span className="task-description">
                      {task.description}
                      {task.required && <span className="required">*</span>}
                    </span>
                    <span className={`task-status ${task.status}`}>
                      {task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '●' : '○'}
                    </span>

                    {/* Show deliverables for this task */}
                    {task.deliverables && task.deliverables.length > 0 && (
                      <div className="task-deliverables">
                        {task.deliverables.map(deliverable => (
                          <div
                            key={deliverable.key}
                            className={`deliverable ${deliverable.status}`}
                          >
                            <span className="deliverable-description">
                              {deliverable.description}
                            </span>
                            {deliverable.value && (
                              <span className="deliverable-value">: {deliverable.value}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {state.status === 'completed' && (
            <div className="state-check">✓</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Enhanced Real-Time Update Triggers

### When Updates Are Sent

1. **First Message Detection**
   - Triggers: `complete_todo_list` with `update_trigger: "first_message"`
   - Includes: `all_deliverable_states`, `remaining_steps_count`
   - Initializes todo list display with complete context

2. **SAFE Route Completion (InputGate)**
   - Triggers: `complete_todo_list` with `update_trigger: "safe_route_completed"`
   - Includes: All deliverable states, remaining steps count
   - Sent after every InputGate completion

3. **UNSAFE Route Completion (Aggregator)**
   - Triggers: `complete_todo_list` with `update_trigger: "unsafe_route_completed"`
   - Includes: Complete context after expert analysis
   - Sent after every Aggregator completion

4. **Deliverable Collection**
   - Triggers: `plan_deliverable_update` with reasoning
   - Includes: Confidence, acceptance criteria, reasoning explanation
   - Updates deliverable display with justification

5. **Step Advancement**
   - Triggers: `step_change_notification` + `complete_todo_list`
   - Updates: Progress, remaining steps, collected deliverables
   - Provides complete visibility into conversation progression

6. **Context-Aware Processing**
   - Both InputGate and Aggregator now have:
     * Current step with deliverable status
     * Remaining steps with requirements
     * All collected deliverable states
     * Progress and completion status

## State Management Recommendations

### 1. Use Zustand or Redux for Global State

```typescript
// Zustand store example
import { create } from 'zustand';

interface TaskStore {
  todoList: any;
  deliverables: Record<string, any>;
  currentStep: any;
  progress: number;

  setTodoList: (todoList: any) => void;
  updateDeliverable: (key: string, value: any) => void;
  setProgress: (progress: number) => void;
  reset: () => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  todoList: null,
  deliverables: {},
  currentStep: null,
  progress: 0,

  setTodoList: (todoList) => set({ todoList }),
  updateDeliverable: (key, value) => set((state) => ({
    deliverables: { ...state.deliverables, [key]: value }
  })),
  setProgress: (progress) => set({ progress }),
  reset: () => set({
    todoList: null,
    deliverables: {},
    currentStep: null,
    progress: 0
  })
}));
```

### 2. Handle Connection State

```typescript
// Monitor connection and show status
const [connectionStatus, setConnectionStatus] = useState<
  'disconnected' | 'connecting' | 'connected'
>('disconnected');

useEffect(() => {
  if (!room) return;

  const updateConnectionStatus = () => {
    setConnectionStatus(
      room.state === 'connected' ? 'connected' :
      room.state === 'connecting' ? 'connecting' :
      'disconnected'
    );
  };

  room.on('connectionStateChanged', updateConnectionStatus);
  updateConnectionStatus();

  return () => {
    room.off('connectionStateChanged', updateConnectionStatus);
  };
}, [room]);
```

## Testing & Debugging

### 1. Mock Message Generator

```typescript
// Development tool for testing UI without backend
export function generateMockMessages() {
  const messages = [
    {
      type: 'complete_todo_list',
      data: {
        todo_list: {
          initialized: true,
          total_steps: 5,
          current_step_index: 2,
          completed_steps: 1,
          progress_percentage: 20,
          current_step: {
            id: 'information_gathering',
            title: 'Gathering Information',
            status: 'in_progress'
          },
          steps: [/* ... */]
        }
      }
    },
    {
      type: 'plan_deliverable_update',
      data: {
        deliverable_key: 'user_name',
        deliverable_value: 'John Doe',
        step_id: 'greeting'
      }
    }
  ];

  return messages;
}
```

### 2. Console Logging for Debugging

```typescript
// Add debug logging
const handleDataReceived = (payload: Uint8Array) => {
  const message = JSON.parse(new TextDecoder().decode(payload));

  if (process.env.NODE_ENV === 'development') {
    console.group(`📨 Received: ${message.type}`);
    console.log('Timestamp:', message.data.timestamp);
    console.log('Data:', message.data);
    console.groupEnd();
  }

  // Handle message...
};
```

## Reasoning Display & User Experience

### 1. Enhanced Deliverable Reasoning Display

```tsx
interface ReasoningDisplayProps {
  deliverable: {
    key: string;
    value: any;
    reasoning?: string;
    confidence?: number;
    acceptance_criteria?: string;
  };
}

export function ReasoningDisplay({ deliverable }: ReasoningDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="deliverable-reasoning">
      <div className="deliverable-summary">
        <span className="deliverable-value">{deliverable.value}</span>
        {deliverable.confidence && (
          <span className="confidence-badge">
            {Math.round(deliverable.confidence * 100)}% confidence
          </span>
        )}
        {deliverable.reasoning && (
          <button
            className="show-reasoning-btn"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} reasoning
          </button>
        )}
      </div>

      {showDetails && deliverable.reasoning && (
        <div className="reasoning-details">
          <div className="reasoning-text">
            <strong>Why this was collected:</strong>
            <p>{deliverable.reasoning}</p>
          </div>
          {deliverable.acceptance_criteria && (
            <div className="acceptance-criteria">
              <strong>Acceptance criteria:</strong>
              <p>{deliverable.acceptance_criteria}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### 2. Reasoning-Enhanced Notifications

```tsx
export function showReasoningNotification(deliverable: any) {
  // Enhanced notification with reasoning
  toast.success(
    <div className="reasoning-notification">
      <div className="notification-header">
        <strong>✅ Collected: {deliverable.deliverable_key}</strong>
      </div>
      <div className="notification-body">
        <div className="collected-value">
          Value: <strong>{deliverable.deliverable_value}</strong>
        </div>
        {deliverable.confidence && (
          <div className="confidence">
            Confidence: {Math.round(deliverable.confidence * 100)}%
          </div>
        )}
        {deliverable.reasoning && (
          <details className="reasoning-details">
            <summary>Why was this collected?</summary>
            <p>{deliverable.reasoning}</p>
          </details>
        )}
      </div>
    </div>,
    {
      duration: 6000, // Longer duration for reasoning content
      position: 'top-right'
    }
  );
}
```

### 3. Reasoning-Aware Form Validation

```tsx
// Use reasoning to provide better user feedback
export function DeliverableFormField({
  deliverable,
  onUpdate
}: {
  deliverable: Deliverable;
  onUpdate: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const [isValid, setIsValid] = useState(false);

  // Real-time validation hint based on acceptance criteria
  const getValidationHint = () => {
    if (!deliverable.acceptance_criteria) return '';

    if (deliverable.key === 'user_name' && ['hi', 'hello', 'hey'].includes(value.toLowerCase())) {
      return '⚠️ Greetings are not accepted as names. Please provide your actual name.';
    }

    return `💡 Tip: ${deliverable.acceptance_criteria}`;
  };

  return (
    <div className="deliverable-form-field">
      <label htmlFor={deliverable.key}>
        {deliverable.description}
        {deliverable.required && <span className="required">*</span>}
      </label>

      <input
        id={deliverable.key}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onUpdate(value)}
        placeholder={`Enter ${deliverable.description.toLowerCase()}`}
      />

      <div className="validation-hint">
        {getValidationHint()}
      </div>

      {deliverable.acceptance_criteria && (
        <div className="acceptance-criteria-hint">
          <small>Expected: {deliverable.acceptance_criteria}</small>
        </div>
      )}
    </div>
  );
}
```

## Best Practices

### 1. Optimistic Updates
- Update UI immediately on user action
- Reconcile with server response
- Show loading states appropriately

### 2. Error Handling
```typescript
try {
  const message = JSON.parse(payload);
  handleMessage(message);
} catch (error) {
  console.error('Message parsing failed:', error);
  // Show user-friendly error
  showNotification('Connection issue detected', 'error');
}
```

### 3. Performance Optimization
- Debounce rapid updates
- Use React.memo for step components
- Virtual scrolling for long step lists

### 4. Accessibility
- Announce step changes to screen readers
- Keyboard navigation for step list
- ARIA labels for progress indicators

## Sample Complete Implementation

```tsx
// Complete TaskDisplay component
import React, { useEffect, useState } from 'react';
import { Room } from 'livekit-client';
import { useTaskStore } from './stores/taskStore';
import { TaskProgressBar } from './TaskProgressBar';
import { DeliverablesView } from './DeliverablesView';
import { StepList } from './StepList';

export function TaskDisplay({ room }: { room: Room }) {
  const {
    todoList,
    deliverables,
    progress,
    setTodoList,
    updateDeliverable,
    setProgress
  } = useTaskStore();

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));

        switch (message.type) {
          case 'complete_todo_list':
            setTodoList(message.data.todo_list);
            setProgress(message.data.todo_list.progress_percentage);
            break;

          case 'plan_deliverable_update':
            updateDeliverable(
              message.data.deliverable_key,
              message.data.deliverable_value
            );
            break;

          case 'plan_progress_update':
            setProgress(message.data.progress.percentage);
            break;
        }
      } catch (error) {
        console.error('Failed to handle message:', error);
      }
    };

    room.on('dataReceived', handleDataReceived);

    return () => {
      room.off('dataReceived', handleDataReceived);
    };
  }, [room, setTodoList, updateDeliverable, setProgress]);

  if (!todoList?.initialized) {
    return <div>Waiting for conversation to start...</div>;
  }

  return (
    <div className="task-display">
      <TaskProgressBar
        progress={progress}
        currentState={todoList.current_state_index}
        totalStates={todoList.total_states}
        currentTask={todoList.current_task}
        processingMode={todoList.current_state?.type}
      />

      <div className="task-content">
        <StateList states={todoList.states} />

        {todoList.current_state && (
          <DeliverablesView
            deliverables={deliverables}
            currentStateDeliverables={
              todoList.states.find(
                s => s.id === todoList.current_state.id
              )?.tasks?.flatMap(t => t.deliverables) || []
            }
          />
        )}
      </div>
    </div>
  );
}
```

## Troubleshooting

### Common Issues & Solutions

1. **Messages not received**
   - Check WebRTC connection status
   - Verify data channel is open
   - Check for message parsing errors

2. **Deliverables not updating**
   - Verify deliverable keys match
   - Check confidence thresholds
   - Ensure validation passes

3. **Progress bar stuck**
   - Check step completion logic
   - Verify auto_advance settings
   - Check for blocked deliverables

4. **Duplicate updates**
   - Implement deduplication by timestamp
   - Use message IDs if available
   - Debounce rapid updates

## Summary

This enhanced system provides a comprehensive, context-aware task and deliverable tracking mechanism that:

1. **Intelligently detects** information using reasoning-based LLM analysis
2. **Prevents false positives** by rejecting greetings and requiring justification
3. **Provides complete context** to both InputGate and Aggregator components
4. **Sends enhanced real-time updates** with reasoning and acceptance criteria
5. **Maintains full awareness** of remaining work and collected information
6. **Supports natural conversation flow** with multi-step processing capabilities
7. **Delivers comprehensive state** for rich, informative UI displays

### New Enhanced Features

#### Context Awareness
- **InputGate** receives: Current step + remaining steps + all deliverable states
- **Aggregator** receives: Complete task context for expert synthesis decisions
- **Both components** know exactly what's needed next and what's already collected

#### Reasoning-Based Detection
- **LLM justification**: Must explain WHY value matches acceptance criteria
- **Greeting protection**: "Hi", "Hello" etc. cannot be interpreted as names
- **Criteria-aware**: System validates against specific acceptance criteria
- **Enhanced frontend visibility**: Reasoning displayed alongside collected values
- **Transparency**: Users can understand why information was collected

#### Complete Frontend Updates
- **`all_deliverable_states`**: Full step-by-step deliverable status
- **`remaining_steps_count`**: Clear visibility into remaining work
- **Reasoning visibility**: See WHY deliverables were detected
- **Acceptance criteria**: Display requirements and compliance

#### Enhanced Message Examples
- Complete todo list with all deliverable states across all steps
- Deliverable updates with confidence scores and reasoning
- Step progression with full context awareness
- Real-time updates after both SAFE and UNSAFE processing routes

### Integration Benefits

Frontend developers can now build sophisticated interfaces that:
- Show complete conversation progress with deliverable-level detail
- Display reasoning for why information was collected
- Provide clear acceptance criteria to users
- Handle both simple (InputGate) and complex (Expert+Aggregator) processing flows
- Maintain complete state visibility throughout the conversation

This system ensures that both backend components (InputGate and Aggregator) and the frontend have complete awareness of conversation context, enabling intelligent decision-making and rich user experiences.

## 🚀 NEW: Enhanced Reasoning & State Transition Support

### Major Frontend Changes (v2.5)

#### 1. **AI Reasoning Transparency (THOUGHT Field)**

The AI now provides step-by-step reasoning before every response, giving complete visibility into its decision-making process.

**New Data Structure:**
```typescript
interface AIResponse {
  thought: string;          // NEW: AI's step-by-step reasoning
  verdict: "safe" | "unsafe";
  experts: string[];
  deliverables: Record<string, DeliverableValue>;
  state_transition: "READY" | null;  // NEW: State completion signal
  message: string;
}
```

**Thought Process Format:**
```
1. Analyze the user's input and what information they provided
2. Check collected deliverables for any updates or corrections
3. Identify any new deliverables from pending tasks
4. Determine if all required tasks are now complete
5. Plan conversational MESSAGE and next question (max ONE question)
```

**Frontend Integration:**
```tsx
// Optional: Display AI reasoning for debugging or transparency
interface ThoughtDisplayProps {
  thought: string;
  showToUser?: boolean;  // Usually false for production
}

export function ThoughtDisplay({ thought, showToUser = false }: ThoughtDisplayProps) {
  if (!showToUser) {
    // Log for debugging only
    console.log('[AI Reasoning]:', thought);
    return null;
  }

  return (
    <details className="ai-reasoning">
      <summary>🤔 How did the AI decide this?</summary>
      <ol>
        {thought.split(/\d+\./).filter(Boolean).map((step, i) => (
          <li key={i}>{step.trim()}</li>
        ))}
      </ol>
    </details>
  );
}
```

#### 2. **Automatic State Completion (STATE_TRANSITION Signal)**

The AI now explicitly signals when all required deliverables are collected, enabling automatic state transitions.

**New Message Type:**
```typescript
// Message Type: "state_transition_ready"
{
  "type": "decision_stream",
  "data": {
    "step": "state_transition_ready",
    "decision": "State transition triggered - Advanced to: memory_game",
    "metadata": {
      "trigger": "STATE_TRANSITION_READY",
      "previous_state": "introduction",
      "new_state": "memory_game",
      "ai_thought": "All required deliverables collected: user_name, user_age, user_location..."
    }
  }
}
```

**Frontend Integration:**
```tsx
// Handle automatic state transitions
const handleDecisionStream = (data: any) => {
  if (data.step === "state_transition_ready") {
    // State changed automatically!
    const { previous_state, new_state, ai_thought } = data.metadata;

    // Update UI
    showStateTransitionAnimation(previous_state, new_state);

    // Optional: Show AI reasoning
    console.log('Transition reasoning:', ai_thought);

    // Trigger confetti or celebration animation
    if (isPositiveTransition(previous_state, new_state)) {
      triggerCelebration();
    }
  }
};
```

#### 3. **Collected Deliverables Display**

For STRICT mode states, the AI now sees (and the frontend should display) what deliverables have already been collected.

**New Section in complete_todo_list:**
```typescript
interface CollectedDeliverablesDisplay {
  state_id: string;
  collected: Array<{
    key: string;
    value: any;
    can_be_updated: boolean;  // Always true - user can correct
  }>;
}
```

**Frontend Component:**
```tsx
interface CollectedDeliverablesProps {
  stateId: string;
  collected: Record<string, any>;
  onUpdate?: (key: string, newValue: any) => void;
}

export function CollectedDeliverables({
  stateId,
  collected,
  onUpdate
}: CollectedDeliverablesProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);

  return (
    <div className="collected-deliverables">
      <h4>✅ Information Collected in This State</h4>
      <p className="update-hint">
        💡 You can update any value if you provided incorrect information
      </p>

      {Object.entries(collected).map(([key, deliverable]) => (
        <div key={key} className="collected-item">
          <span className="deliverable-key">{key}:</span>

          {editingKey === key ? (
            <input
              value={deliverable.value}
              onChange={(e) => onUpdate?.(key, e.target.value)}
              onBlur={() => setEditingKey(null)}
              autoFocus
            />
          ) : (
            <>
              <span className="deliverable-value">"{deliverable.value}"</span>
              <button
                className="edit-btn"
                onClick={() => setEditingKey(key)}
                title="Click to update"
              >
                ✏️
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
```

#### 4. **Enhanced Deliverable Status Markers**

Deliverables now have clear status indicators with update capabilities.

**Status Types:**
```typescript
enum DeliverableStatus {
  PENDING = "pending",        // Not yet collected
  COMPLETED = "completed",    // Collected (can be updated)
  SKIPPED = "skipped"         // Intentionally skipped
}
```

**Status Display Component:**
```tsx
interface DeliverableStatusBadgeProps {
  status: DeliverableStatus;
  value?: any;
}

export function DeliverableStatusBadge({
  status,
  value
}: DeliverableStatusBadgeProps) {
  const badges = {
    pending: {
      icon: '⏳',
      label: 'PENDING',
      className: 'status-pending',
      hint: 'Needs collection'
    },
    completed: {
      icon: '✅',
      label: 'COMPLETED',
      className: 'status-completed',
      hint: `Value: ${value} (can be updated if new evidence)`
    },
    skipped: {
      icon: '⏭️',
      label: 'SKIPPED',
      className: 'status-skipped',
      hint: 'Intentionally skipped'
    }
  };

  const badge = badges[status];

  return (
    <span
      className={`deliverable-status ${badge.className}`}
      title={badge.hint}
    >
      {badge.icon} {badge.label}
    </span>
  );
}
```

#### 5. **Conditional Jump Visualization**

When the AI encounters a conditional decision point (e.g., "Do you want to continue?"), the frontend can display both possible paths.

**New Message Enhancement:**
```typescript
// In decision_stream metadata when conditional paths exist
{
  "conditional_paths": {
    "deliverable_key": "wants_to_continue",
    "paths": {
      "continue": {
        "description": "User wants to continue with more challenging levels",
        "example_responses": ["Yes, let's keep going", "Sure!", "I want to try more"],
        "tasks": ["memory_level_5", "memory_level_6", "memory_level_7"]
      },
      "skip": {
        "description": "User wants to stop and wrap up",
        "example_responses": ["No thanks", "Let's stop here", "I'm tired"],
        "next_state": "feedback_and_closure",
        "tasks_to_skip": ["memory_level_5", "memory_level_6", "memory_level_7"]
      }
    }
  }
}
```

**Frontend Visualization:**
```tsx
interface ConditionalPathDisplayProps {
  paths: {
    continue: {
      description: string;
      example_responses: string[];
      tasks?: string[];
    };
    skip: {
      description: string;
      example_responses: string[];
      next_state: string;
      tasks_to_skip?: string[];
    };
  };
}

export function ConditionalPathDisplay({ paths }: ConditionalPathDisplayProps) {
  return (
    <div className="conditional-paths">
      <div className="path-header">
        <span className="icon">🔀</span>
        <h4>Decision Point</h4>
      </div>

      <div className="paths-container">
        <div className="path path-continue">
          <div className="path-badge">✅ Continue Path</div>
          <p>{paths.continue.description}</p>
          <div className="examples">
            <strong>Example responses:</strong>
            <ul>
              {paths.continue.example_responses.map((ex, i) => (
                <li key={i}>"{ex}"</li>
              ))}
            </ul>
          </div>
          {paths.continue.tasks && (
            <div className="tasks-preview">
              Will proceed with: {paths.continue.tasks.join(', ')}
            </div>
          )}
        </div>

        <div className="path path-skip">
          <div className="path-badge">⏭️ Skip Path</div>
          <p>{paths.skip.description}</p>
          <div className="examples">
            <strong>Example responses:</strong>
            <ul>
              {paths.skip.example_responses.map((ex, i) => (
                <li key={i}>"{ex}"</li>
              ))}
            </ul>
          </div>
          {paths.skip.tasks_to_skip && (
            <div className="tasks-skip">
              ⚠️ Will skip: {paths.skip.tasks_to_skip.join(', ')}
            </div>
          )}
          <div className="next-state">
            → Next: {paths.skip.next_state}
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### 6. **Enhanced Message Handling**

**Updated Message Handler:**
```typescript
const handleDataReceived = (payload: Uint8Array) => {
  const message = JSON.parse(new TextDecoder().decode(payload));

  switch (message.type) {
    case 'complete_todo_list':
      handleCompleteTodoList(message.data);
      break;

    case 'decision_stream':
      // NEW: Handle state transition signals
      if (message.data.step === 'state_transition_ready') {
        handleStateTransitionReady(message.data);
      } else if (message.data.step === 'conditional_skip_executed') {
        handleConditionalSkip(message.data);
      }
      break;

    case 'plan_deliverable_update':
      handleDeliverableUpdate(message.data);
      break;

    // ... other message types
  }
};

const handleStateTransitionReady = (data: any) => {
  const { previous_state, new_state, ai_thought } = data.metadata;

  console.log('[State Transition]', {
    from: previous_state,
    to: new_state,
    reason: ai_thought
  });

  // Show transition animation
  showStateTransition(previous_state, new_state);

  // Update UI state
  setCurrentState(new_state);
};

const handleConditionalSkip = (data: any) => {
  const { skipped_tasks, skip_reason, next_state } = data.metadata;

  // Update UI to show skipped tasks
  setSkippedTasks(prev => [...prev, ...skipped_tasks]);

  // Show notification
  showNotification(
    `Skipped ${skipped_tasks.length} tasks`,
    skip_reason,
    'info'
  );
};
```

#### 7. **Frontend Integration Checklist**

**Required Changes:**
- [ ] Add THOUGHT field parsing (for debugging/transparency)
- [ ] Implement STATE_TRANSITION handling for automatic advancement
- [ ] Display collected deliverables section in STRICT mode
- [ ] Add status badges for PENDING/COMPLETED/SKIPPED deliverables
- [ ] Hide examples for completed deliverables (reduce clutter)
- [ ] Implement conditional path visualization
- [ ] Handle conditional skip notifications
- [ ] Add state transition animations

**Optional Enhancements:**
- [ ] Show AI reasoning toggle for transparency
- [ ] Add deliverable edit capability for corrections
- [ ] Implement confetti/celebration on state completion
- [ ] Add progress predictions based on remaining deliverables
- [ ] Show task skip history

#### 8. **Example Complete Integration**

```tsx
// Enhanced TaskDisplay with all new features
export function EnhancedTaskDisplay({ room }: { room: Room }) {
  const [todoList, setTodoList] = useState<any>(null);
  const [currentState, setCurrentState] = useState<any>(null);
  const [collectedInState, setCollectedInState] = useState<Record<string, any>>({});
  const [conditionalPaths, setConditionalPaths] = useState<any>(null);
  const [showAIReasoning, setShowAIReasoning] = useState(false);
  const [lastThought, setLastThought] = useState<string>('');

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (payload: Uint8Array) => {
      const message = JSON.parse(new TextDecoder().decode(payload));

      switch (message.type) {
        case 'complete_todo_list':
          setTodoList(message.data.todo_list);
          setCurrentState(message.data.todo_list.current_state);

          // Extract collected deliverables for current state
          if (message.data.all_deliverable_states) {
            const stateId = message.data.todo_list.current_state?.id;
            if (stateId && message.data.all_deliverable_states[stateId]) {
              const stateDeliverables = message.data.all_deliverable_states[stateId].deliverables;
              const collected = Object.entries(stateDeliverables)
                .filter(([_, d]: [string, any]) => d.status === 'completed')
                .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
              setCollectedInState(collected);
            }
          }
          break;

        case 'decision_stream':
          // Store AI thought if present
          if (message.data.metadata?.thought_summary) {
            setLastThought(message.data.metadata.thought_summary);
          }

          // Handle state transitions
          if (message.data.step === 'state_transition_ready') {
            const { new_state, ai_thought } = message.data.metadata;
            showStateTransition(new_state);
            if (ai_thought) setLastThought(ai_thought);
          }

          // Handle conditional paths
          if (message.data.metadata?.conditional_paths) {
            setConditionalPaths(message.data.metadata.conditional_paths);
          }
          break;

        // ... other handlers
      }
    };

    room.on('dataReceived', handleDataReceived);
    return () => room.off('dataReceived', handleDataReceived);
  }, [room]);

  if (!todoList?.initialized) {
    return <div>Waiting for conversation to start...</div>;
  }

  return (
    <div className="enhanced-task-display">
      {/* Progress with processing mode */}
      <TaskProgressBar
        progress={todoList.progress_percentage}
        currentState={todoList.current_state_index}
        totalStates={todoList.total_states}
        currentTask={todoList.current_task}
        processingMode={currentState?.type}
      />

      {/* AI Reasoning Toggle (optional) */}
      {showAIReasoning && lastThought && (
        <ThoughtDisplay thought={lastThought} showToUser={true} />
      )}

      {/* Collected Deliverables (STRICT mode only) */}
      {currentState?.type === 'strict' && Object.keys(collectedInState).length > 0 && (
        <CollectedDeliverables
          stateId={currentState.id}
          collected={collectedInState}
          onUpdate={(key, value) => {
            // User can correct collected values
            // Send update via voice or text
            console.log(`User updated ${key} to ${value}`);
          }}
        />
      )}

      {/* Conditional Paths Visualization */}
      {conditionalPaths && (
        <ConditionalPathDisplay paths={conditionalPaths.paths} />
      )}

      {/* State List with enhanced status */}
      <StateList states={todoList.states} />

      {/* Deliverables with enhanced status markers */}
      <DeliverablesView
        deliverables={todoList.all_deliverable_states}
        currentState={currentState}
      />

      {/* Debug panel */}
      <button onClick={() => setShowAIReasoning(!showAIReasoning)}>
        {showAIReasoning ? 'Hide' : 'Show'} AI Reasoning
      </button>
    </div>
  );
}
```

### Summary of Frontend Changes

#### Enhanced Capabilities

1. **AI Transparency**: THOUGHT field provides complete reasoning visibility
2. **Automatic Transitions**: STATE_TRANSITION signals enable automatic state progression
3. **Memory Display**: Collected deliverables shown in STRICT mode
4. **Status Clarity**: Clear PENDING/COMPLETED/SKIPPED indicators
5. **Smart Examples**: Examples hidden for completed deliverables
6. **Path Visualization**: Conditional decisions shown with both outcomes
7. **Skip Tracking**: Tasks marked as SKIPPED when user chooses alternate paths

#### Implementation Priority

**High Priority** (Core functionality):
- ✅ STATE_TRANSITION handling
- ✅ Enhanced status display
- ✅ Collected deliverables section

**Medium Priority** (Enhanced UX):
- 🔄 Conditional path visualization
- 🔄 State transition animations
- 🔄 Skip notifications

**Low Priority** (Optional):
- 💡 THOUGHT display for users
- 💡 Deliverable correction UI
- 💡 Celebration animations

The reasoning feature provides unprecedented transparency into the AI's decision-making process, helping users understand why their information was collected and building trust in the system.

## State Machine Architecture Summary

The conversation system uses a **state machine architecture only** (legacy step-based plans have been removed) that provides natural conversation flow and enhanced progress tracking:

### Key Concepts

#### 1. **Hierarchical Structure**
- **States**: High-level conversation phases (e.g., "introduction", "memory_game", "feedback")
- **Tasks**: Specific objectives within each state (e.g., "collect_name", "memory_level_1")
- **Deliverables**: Information collected from each task (e.g., user_name, shopping_list_1)

#### 2. **Processing Modes**
- **STRICT States** ⚡: Tasks completed sequentially, one at a time
- **LOOSE States** 🔄: Tasks completed flexibly in any order
- **UI Impact**: Different progress display and user guidance per mode

#### 3. **Enhanced Features**
- **Task-Level Progress**: Fine-grained tracking within states
- **Processing Mode Awareness**: UI adapts to strict vs loose execution
- **State Transitions**: Automatic progression based on completion criteria
- **Deliverable Reasoning**: Transparent AI decision-making with explanations

### Implementation Benefits

1. **Natural Flow**: States group related conversation phases logically
2. **Flexible Execution**: LOOSE states allow natural information collection
3. **Sequential Control**: STRICT states ensure proper ordering when needed
4. **Rich Progress Tracking**: Both state and task completion visibility
5. **Enhanced UX**: Processing mode indicators guide user interaction

Frontend developers can build rich interfaces that show conversation progress at both the state level (major phases) and task level (specific objectives), with clear visual indicators for different processing modes.