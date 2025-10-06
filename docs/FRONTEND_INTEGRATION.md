# Frontend Integration Guide

Complete guide for integrating your frontend application with the Session Management Server.

## Table of Contents

- [Quick Start](#quick-start)
- [API Base Configuration](#api-base-configuration)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Complete Workflows](#complete-workflows)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Quick Start

### 1. Install Dependencies

```bash
npm install livekit-client
# or
yarn add livekit-client
```

### 2. Configure API Client

```typescript
// src/config/api.ts
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

export const apiClient = {
  async get(path: string) {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },

  async post(path: string, data: any) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },

  async delete(path: string) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  },
};
```

### 3. Basic Usage Example

```typescript
import { apiClient } from './config/api';
import { Room } from 'livekit-client';

// Create a project
const project = await apiClient.post('/projects', {
  name: 'My AI Project'
});

// Create a session
const session = await apiClient.post(`/projects/${project.id}/sessions`, {
  planId: 'cognitive_stimulation_demo_sm' // optional
});

// Get join token for a user
const { token, serverUrl } = await apiClient.post(
  `/sessions/${session.id}/joinToken`,
  {
    identity: 'user-123',
    name: 'John Doe'
  }
);

// Connect to LiveKit room
const room = new Room();
await room.connect(serverUrl, token);

console.log('Connected to session!');
```

## API Base Configuration

### Environment Variables

```env
# .env.local
REACT_APP_API_URL=http://localhost:3000
REACT_APP_LIVEKIT_URL=ws://localhost:7880
```

### Request Headers

All requests should include:

```typescript
headers: {
  'Content-Type': 'application/json',
  // Add authorization header when auth is implemented
  // 'Authorization': `Bearer ${token}`
}
```

### Response Format

All successful responses return JSON:

```typescript
{
  // Response data
}
```

Error responses (4xx, 5xx):

```typescript
{
  "statusCode": 400,
  "timestamp": "2025-10-03T12:00:00.000Z",
  "path": "/sessions/invalid-id",
  "message": "Session with ID invalid-id not found"
}
```

## Core Concepts

### Project
Top-level container for organizing sessions. Create one project per application or use case.

### Session
Represents one conversation/interaction. Each session has:
- Unique LiveKit room
- Optional plan configuration
- Participants and messages
- Associated agents

### Agent
AI agent running in a Kubernetes pod that joins the session's LiveKit room.

### Participant
User or agent connected to a session's LiveKit room.

## API Reference

### Projects API

#### Create Project

```typescript
POST /projects

Request:
{
  "name": string  // 1-255 characters
}

Response:
{
  "id": string,
  "name": string,
  "createdAt": string,
  "updatedAt": string
}
```

#### List Projects

```typescript
GET /projects

Response:
[
  {
    "id": string,
    "name": string,
    "createdAt": string,
    "updatedAt": string,
    "activeSessions": number,
    "activeAgents": number,
    "totalSessions": number
  }
]
```

#### Get Project

```typescript
GET /projects/:projectId

Response:
{
  "id": string,
  "name": string,
  "createdAt": string,
  "updatedAt": string,
  "sessions": Session[]  // Last 10 sessions
}
```

#### Get Project Statistics

```typescript
GET /projects/:projectId/stats

Response:
{
  "totalSessions": number,
  "activeSessions": number,
  "totalAgents": number,
  "activeAgents": number,
  "totalMessages": number,
  "totalParticipants": number
}
```

#### Delete Project

```typescript
DELETE /projects/:projectId

Response:
{
  "message": "Project deleted successfully"
}
```

### Sessions API

#### Create Session

```typescript
POST /projects/:projectId/sessions

Request:
{
  "planId"?: string  // Optional plan identifier
}

Response:
{
  "id": string,
  "projectId": string,
  "status": "ACTIVE" | "CLOSED",
  "createdAt": string,
  "closedAt": string | null,
  "room": {
    "id": string,
    "sessionId": string,
    "livekitRoomName": string,
    "serverUrl": string
  }
}
```

#### List Sessions

```typescript
GET /projects/:projectId/sessions
Query params:
  - status?: "ACTIVE" | "CLOSED"
  - search?: string
  - skip?: number (default: 0)
  - take?: number (default: 20, max: 100)

Response:
{
  "data": Session[],
  "total": number,
  "skip": number,
  "take": number
}
```

#### Get Session

```typescript
GET /sessions/:sessionId

Response:
{
  "id": string,
  "projectId": string,
  "status": "ACTIVE" | "CLOSED",
  "createdAt": string,
  "closedAt": string | null,
  "room": {
    "id": string,
    "livekitRoomName": string,
    "serverUrl": string
  },
  "agents": AgentInstance[],
  "participants": Participant[],  // Currently connected
  "_count": {
    "messages": number,
    "events": number
  }
}
```

#### Create Join Token

```typescript
POST /sessions/:sessionId/joinToken

Request:
{
  "identity": string,    // Unique participant identifier
  "name"?: string        // Display name (optional)
}

Response:
{
  "token": string,         // JWT token for LiveKit
  "serverUrl": string,     // LiveKit server URL
  "roomName": string       // LiveKit room name
}
```

#### Get Session Timeline

```typescript
GET /sessions/:sessionId/timeline
Query params:
  - skip?: number (default: 0)
  - take?: number (default: 50)

Response:
{
  "timeline": Array<{
    "type": "message" | "event",
    "data": Message | RoomEvent
  }>,
  "total": number
}
```

#### Close Session

```typescript
DELETE /sessions/:sessionId

Response:
{
  "message": "Session closed successfully"
}
```

### Agents API

#### Start Agent

```typescript
POST /sessions/:sessionId/agents

Request:
{
  "role": string,        // e.g., "conversational-ai"
  "planId"?: string      // Optional plan configuration
}

Response:
{
  "id": string,
  "sessionId": string,
  "role": string,
  "status": "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED",
  "podName": string,
  "secretName": string,
  "planId": string | null,
  "createdAt": string,
  "stoppedAt": string | null
}
```

#### Get Agent

```typescript
GET /agents/:agentId

Response:
{
  "id": string,
  "sessionId": string,
  "role": string,
  "status": string,
  "podName": string,
  "secretName": string,
  "planId": string | null,
  "createdAt": string,
  "stoppedAt": string | null,
  "session": {
    "id": string,
    "room": {
      "livekitRoomName": string,
      "serverUrl": string
    }
  },
  "podStatus": {
    "phase": "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown",
    "conditions": Array<any>,
    "containerStatuses": Array<any>
  } | null
}
```

#### Get Agent Logs

```typescript
GET /agents/:agentId/logs

Response: string  // Last 100 lines of pod logs
```

#### Stop Agent

```typescript
DELETE /agents/:agentId

Response:
{
  "message": "Agent stopped successfully"
}
```

## Complete Workflows

### Workflow 1: Create Session and Join as User

```typescript
// 1. Create project (one-time setup)
const project = await apiClient.post('/projects', {
  name: 'Customer Support AI'
});

// 2. Create session
const session = await apiClient.post(`/projects/${project.id}/sessions`, {
  planId: 'cognitive_stimulation_demo_sm'
});

// 3. Start agent (optional)
const agent = await apiClient.post(`/sessions/${session.id}/agents`, {
  role: 'conversational-ai',
  planId: 'cognitive_stimulation_demo_sm'
});

// 4. Get join token for user
const { token, serverUrl } = await apiClient.post(
  `/sessions/${session.id}/joinToken`,
  {
    identity: `user-${userId}`,
    name: userName
  }
);

// 5. Connect to LiveKit room
const room = new Room();
await room.connect(serverUrl, token);

// 6. Set up event listeners
room.on('participantConnected', (participant) => {
  console.log('Participant joined:', participant.identity);
});

room.on('dataReceived', (payload, participant) => {
  const message = JSON.parse(new TextDecoder().decode(payload));
  console.log('Received message:', message);
});

// 7. Send messages
const sendMessage = async (text: string) => {
  const message = {
    type: 'user_text',
    data: text
  };
  const encoder = new TextEncoder();
  await room.localParticipant.publishData(encoder.encode(JSON.stringify(message)));
};
```

### Workflow 2: Monitor Active Sessions

```typescript
// Fetch all active sessions for a project
const fetchActiveSessions = async (projectId: string) => {
  const response = await apiClient.get(
    `/projects/${projectId}/sessions?status=ACTIVE&take=50`
  );
  return response.data;
};

// Poll for updates every 5 seconds
useEffect(() => {
  const interval = setInterval(async () => {
    const sessions = await fetchActiveSessions(projectId);
    setActiveSessions(sessions);
  }, 5000);

  return () => clearInterval(interval);
}, [projectId]);
```

### Workflow 3: Display Session Timeline

```typescript
// Fetch session timeline with pagination
const fetchTimeline = async (sessionId: string, skip = 0, take = 50) => {
  return apiClient.get(
    `/sessions/${sessionId}/timeline?skip=${skip}&take=${take}`
  );
};

// Component example
function SessionTimeline({ sessionId }: { sessionId: string }) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTimeline() {
      const { timeline: data } = await fetchTimeline(sessionId);
      setTimeline(data);
      setLoading(false);
    }
    loadTimeline();
  }, [sessionId]);

  if (loading) return <div>Loading timeline...</div>;

  return (
    <div>
      {timeline.map((item) => (
        <div key={item.data.id}>
          {item.type === 'message' ? (
            <MessageItem message={item.data} />
          ) : (
            <EventItem event={item.data} />
          )}
        </div>
      ))}
    </div>
  );
}
```

### Workflow 4: Agent Lifecycle Management

```typescript
// Start agent and monitor status
async function startAndMonitorAgent(sessionId: string, planId: string) {
  // Start agent
  const agent = await apiClient.post(`/sessions/${sessionId}/agents`, {
    role: 'conversational-ai',
    planId
  });

  // Poll for agent status
  const checkStatus = async () => {
    const agentData = await apiClient.get(`/agents/${agent.id}`);

    if (agentData.status === 'RUNNING') {
      console.log('Agent is running!');
      return true;
    } else if (agentData.status === 'FAILED') {
      console.error('Agent failed to start');
      // Fetch logs for debugging
      const logs = await apiClient.get(`/agents/${agent.id}/logs`);
      console.error('Agent logs:', logs);
      return false;
    }

    // Still starting, check again
    setTimeout(checkStatus, 2000);
  };

  await checkStatus();
  return agent;
}

// Stop agent when session ends
async function stopAgent(agentId: string) {
  await apiClient.delete(`/agents/${agentId}`);
  console.log('Agent stopped');
}
```

## Error Handling

### Common Error Patterns

```typescript
// Wrapper function with error handling
async function apiCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error) {
      // Parse error response
      try {
        const errorData = JSON.parse(error.message);
        console.error('API Error:', errorData);

        // Handle specific error codes
        switch (errorData.statusCode) {
          case 404:
            toast.error('Resource not found');
            break;
          case 400:
            toast.error(`Invalid request: ${errorData.message}`);
            break;
          case 500:
            toast.error('Server error, please try again');
            break;
          default:
            toast.error('An error occurred');
        }
      } catch {
        console.error('Error:', error.message);
        toast.error('Network error');
      }
    }
    return null;
  }
}

// Usage
const session = await apiCall(() =>
  apiClient.post(`/projects/${projectId}/sessions`, { planId })
);

if (!session) {
  // Handle error case
  return;
}
```

### Validation Errors

The server validates all inputs. Common validation errors:

```typescript
// Invalid project name
{
  "statusCode": 400,
  "message": [
    "name should not be empty",
    "name must be a string"
  ]
}

// Invalid session ID
{
  "statusCode": 404,
  "message": "Session with ID invalid-id not found"
}
```

## Best Practices

### 1. Polling vs WebSockets

For now, use polling for real-time updates:

```typescript
// Poll every 5 seconds for active sessions
useInterval(() => {
  fetchActiveSessions();
}, 5000);

// Poll every 2 seconds for agent status
useInterval(() => {
  if (agentId && agentStatus !== 'RUNNING') {
    checkAgentStatus(agentId);
  }
}, 2000);
```

WebSocket support is planned for future releases.

### 2. Caching

Cache project and session data to reduce API calls:

```typescript
// Using React Query
const { data: project } = useQuery(
  ['project', projectId],
  () => apiClient.get(`/projects/${projectId}`),
  {
    staleTime: 60000, // 1 minute
    cacheTime: 300000, // 5 minutes
  }
);
```

### 3. Optimistic Updates

Update UI immediately, then sync with server:

```typescript
// Optimistic session creation
const createSession = async (projectId: string, planId?: string) => {
  // Create temporary session object
  const tempSession = {
    id: 'temp-' + Date.now(),
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    // ...
  };

  // Update UI immediately
  setSessions([tempSession, ...sessions]);

  try {
    // Create on server
    const realSession = await apiClient.post(
      `/projects/${projectId}/sessions`,
      { planId }
    );

    // Replace temp with real data
    setSessions(sessions.map(s =>
      s.id === tempSession.id ? realSession : s
    ));
  } catch (error) {
    // Remove temp session on error
    setSessions(sessions.filter(s => s.id !== tempSession.id));
    handleError(error);
  }
};
```

### 4. Cleanup

Always cleanup resources when components unmount:

```typescript
useEffect(() => {
  const room = new Room();

  // Connect to room
  room.connect(serverUrl, token);

  return () => {
    // Disconnect when component unmounts
    room.disconnect();
  };
}, []);
```

### 5. Loading States

Show loading indicators during API calls:

```typescript
const [loading, setLoading] = useState(false);

const handleCreateSession = async () => {
  setLoading(true);
  try {
    const session = await apiClient.post(`/projects/${projectId}/sessions`);
    // Handle success
  } catch (error) {
    // Handle error
  } finally {
    setLoading(false);
  }
};
```

## Next Steps

- See [API_EXAMPLES.md](./API_EXAMPLES.md) for more detailed examples
- See [TYPESCRIPT_TYPES.md](./TYPESCRIPT_TYPES.md) for TypeScript definitions
- See [LIVEKIT_INTEGRATION.md](./LIVEKIT_INTEGRATION.md) for LiveKit client integration
- See [DASHBOARD_GUIDE.md](./DASHBOARD_GUIDE.md) for building dashboard UIs
