---
sidebar_position: 3
title: Session Lifecycle
description: Understanding session states and transitions in STELLA
---

# Session Lifecycle

Sessions in STELLA go through several states from creation to termination. Understanding these states helps with debugging and building features that respond to session events.

## Session States

```
┌────────────┐
│  PENDING   │  Session created, waiting for agent
└─────┬──────┘
      │
      ▼
┌────────────┐
│ CONNECTING │  Agent pod starting, connecting to LiveKit
└─────┬──────┘
      │
      ▼
┌────────────┐
│   ACTIVE   │  Conversation in progress
└─────┬──────┘
      │
      ├─────────────────┐
      ▼                 ▼
┌────────────┐    ┌────────────┐
│  PAUSED    │    │  ENDING    │  User or agent initiated end
└─────┬──────┘    └─────┬──────┘
      │                 │
      └────────┬────────┘
               ▼
         ┌────────────┐
         │   ENDED    │  Session complete, resources cleaned
         └────────────┘
```

## State Descriptions

### PENDING

The session has been created but the agent hasn't started yet.

**Entry conditions:**
- API call to create session
- Agent type specified

**Exit conditions:**
- Agent pod scheduled → CONNECTING
- Timeout (5 minutes) → ENDED
- User cancels → ENDED

```typescript
// Creating a session puts it in PENDING state
const session = await api.createSession({
  projectId: 'project-123',
  agentType: 'stella-agent',
  config: { /* agent config */ }
});
// session.status === 'PENDING'
```

### CONNECTING

The agent pod is starting and connecting to LiveKit.

**Entry conditions:**
- Kubernetes pod scheduled
- Pod is starting

**Exit conditions:**
- Agent connects to LiveKit → ACTIVE
- Pod fails to start → ENDED
- Timeout (2 minutes) → ENDED

**What happens:**
1. Backend creates Kubernetes secret with credentials
2. Backend creates agent pod
3. Pod starts and initializes
4. Agent connects to LiveKit room
5. Agent signals ready

### ACTIVE

The conversation is in progress.

**Entry conditions:**
- Agent successfully connected
- User can join

**Exit conditions:**
- User leaves → ENDING
- Agent crashes → ENDING
- Idle timeout → ENDING
- API call to end → ENDING

**During ACTIVE state:**
- Users can join/leave the room
- Messages are exchanged
- Status updates are sent

```typescript
// Joining an active session
const token = await api.joinSession(sessionId);
// Use token to connect to LiveKit
await room.connect(livekitUrl, token);
```

### PAUSED

The session is temporarily paused (optional state).

**Entry conditions:**
- User requests pause
- Agent requests pause

**Exit conditions:**
- Resume requested → ACTIVE
- Timeout → ENDING
- Cancel requested → ENDING

**Use cases:**
- User needs to step away briefly
- Agent waiting for external process

### ENDING

The session is shutting down.

**Entry conditions:**
- End session requested
- Error occurred
- Timeout reached

**Exit conditions:**
- Cleanup complete → ENDED

**What happens:**
1. Agent receives shutdown signal
2. Agent saves conversation state
3. Agent disconnects from LiveKit
4. Backend deletes Kubernetes pod
5. Backend deletes Kubernetes secret
6. Session marked as ENDED

### ENDED

The session is complete and resources are cleaned up.

**Entry conditions:**
- Cleanup complete

**Characteristics:**
- No more state changes
- Historical data preserved
- Resources freed

## Events

Sessions emit events that you can subscribe to:

### Backend Events (WebSocket)

```typescript
// Connect to WebSocket for session updates
const ws = new WebSocket(`wss://api.example.com/sessions/${sessionId}/ws`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'session.status_changed':
      console.log(`Status: ${data.status}`);
      break;

    case 'session.participant_joined':
      console.log(`${data.participant.name} joined`);
      break;

    case 'session.participant_left':
      console.log(`${data.participant.name} left`);
      break;

    case 'session.message':
      console.log(`${data.speaker}: ${data.content}`);
      break;

    case 'session.error':
      console.error(`Error: ${data.message}`);
      break;
  }
};
```

### Agent Events

```python
class MyAgent(BaseAgent):
    async def on_connect(self):
        """Called when agent connects to the room."""
        print(f"Connected to session: {self.session_id}")

    async def on_participant_joined(self, participant):
        """Called when a user joins."""
        print(f"User joined: {participant.identity}")
        await self.greet_user(participant)

    async def on_participant_left(self, participant):
        """Called when a user leaves."""
        print(f"User left: {participant.identity}")

    async def on_disconnect(self):
        """Called when agent is disconnecting."""
        print("Session ending, saving state...")
        await self.save_conversation()

    async def on_shutdown(self):
        """Called for graceful shutdown."""
        print("Shutting down...")
```

## Timeouts

| State | Timeout | Configurable | Action |
|-------|---------|--------------|--------|
| PENDING | 5 min | Yes | End session |
| CONNECTING | 2 min | Yes | End session, alert |
| ACTIVE (idle) | 30 min | Yes | End session |
| PAUSED | 15 min | Yes | End session |
| ENDING | 1 min | No | Force cleanup |

### Configuring Timeouts

```yaml
# Session configuration
session:
  timeouts:
    pending: 300        # seconds
    connecting: 120     # seconds
    idle: 1800          # seconds
    paused: 900         # seconds
```

## Error Handling

### Agent Crash Recovery

If an agent crashes during an active session:

1. Backend detects pod termination
2. Session moves to ENDING state
3. Error event emitted to clients
4. Resources cleaned up
5. Optional: Auto-restart with state recovery

```typescript
// Frontend handling agent crash
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'session.error' && data.code === 'AGENT_CRASHED') {
    // Show user-friendly message
    showNotification('Connection lost. Reconnecting...');

    // Optionally attempt reconnection
    if (data.recoverable) {
      await reconnectSession(sessionId);
    }
  }
};
```

### Graceful Degradation

When issues occur, STELLA attempts graceful degradation:

1. **STT failure**: Fall back to text input
2. **TTS failure**: Display text response
3. **LLM timeout**: Retry with shorter context
4. **Network issues**: Buffer and retry

## Message Recording

STELLA automatically records all messages exchanged during a session for transcript retrieval, debugging, and audit purposes.

### What Gets Recorded

| Message Type | Description |
|--------------|-------------|
| `transcript` | Final speech-to-text transcriptions (user speech) |
| `agent_text` | Agent responses (final text, not streaming chunks) |
| `user_text` | Direct text input from users |
| `participant_joined/left` | Participant events |
| `complete_todo_list` | Task list updates |
| `state_change_notification` | State machine transitions |
| `debug` | Debug messages (optional retrieval) |

### How It Works

1. **Auto-Discovery**: A message recorder service polls for active sessions
2. **Room Connection**: Connects to LiveKit rooms without subscribing to media
3. **Selective Recording**: Filters out audio streaming, partial chunks, and control messages
4. **Storage**: Messages stored with full envelope, participant attribution, and timestamps

### Retrieving Transcripts

**API Endpoint:**
```
GET /sessions/{sessionId}/messages
```

**Query Parameters:**
- `limit` - Max messages (1-100, default: 50)
- `before` - ISO timestamp for pagination
- `include_debug` - Include debug messages (default: false)

**For agents**, see [Accessing Chat History](/docs/guides/build-your-own-agent#accessing-chat-history).

## Next Steps

- [Kubernetes Orchestration](/docs/architecture/kubernetes-orchestration) - Pod management
- [Data Flow](/docs/architecture/data-flow) - Message flow details
