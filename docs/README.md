# Session Management Server - Frontend Documentation

Complete documentation for integrating your frontend with the Session Management Server.

## Overview

The Session Management Server is a control plane for managing conversational AI sessions with LiveKit WebRTC integration. This documentation provides everything you need to build frontend applications that create projects, manage sessions, deploy AI agents, and enable real-time voice and text communication.

## Documentation Index

### 🚀 [Frontend Integration Guide](./FRONTEND_INTEGRATION.md)
**Start here!** Complete guide for integrating the Session Management Server API into your frontend.

**Covers:**
- Quick start and setup
- API configuration
- Complete API reference
- Request/response formats
- Error handling
- Best practices

**Perfect for:** All frontend developers integrating with the server

---

### 📘 [TypeScript Type Definitions](./TYPESCRIPT_TYPES.md)
TypeScript interfaces and types for the entire API surface.

**Includes:**
- Entity types (Project, Session, Agent, etc.)
- Request DTOs
- Response types
- API client interface
- React hooks examples
- Validation helpers

**Perfect for:** TypeScript developers who want type safety

---

### 🎙️ [LiveKit Integration Guide](./LIVEKIT_INTEGRATION.md)
Complete guide for connecting to sessions using LiveKit client SDK.

**Covers:**
- LiveKit client setup
- Connecting to sessions
- Audio integration (microphone, speakers)
- Data channel communication
- Message types from AI agents
- React hooks for LiveKit
- Troubleshooting

**Perfect for:** Developers building real-time voice/text interfaces

---

### 🎨 [Dashboard Guide](./DASHBOARD_GUIDE.md) *(Coming Soon)*
UI patterns and component examples for building dashboards.

**Will cover:**
- Project overview dashboards
- Session list views
- Live transcript viewers
- Agent status monitoring
- Real-time statistics
- Recommended component libraries

---

### 💡 [API Examples](./API_EXAMPLES.md) *(Coming Soon)*
Practical, copy-paste ready code examples for common scenarios.

**Will cover:**
- Complete workflows
- Pagination examples
- Filtering and search
- Error scenarios
- Performance optimization

---

## Quick Start

### 1. Install Dependencies

```bash
npm install livekit-client
```

### 2. Set Up API Client

```typescript
const API_BASE_URL = 'http://localhost:3000';

export const api = {
  async get(path: string) {
    const res = await fetch(`${API_BASE_URL}${path}`);
    return res.json();
  },
  async post(path: string, data: any) {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
};
```

### 3. Create Your First Session

```typescript
// 1. Create a project
const project = await api.post('/projects', {
  name: 'My AI Project'
});

// 2. Create a session
const session = await api.post(`/projects/${project.id}/sessions`, {
  planId: 'cognitive_stimulation_demo_sm'
});

// 3. Start an AI agent
const agent = await api.post(`/sessions/${session.id}/agents`, {
  role: 'conversational-ai',
  planId: 'cognitive_stimulation_demo_sm'
});

// 4. Get join token for user
const { token, serverUrl } = await api.post(
  `/sessions/${session.id}/joinToken`,
  {
    identity: 'user-123',
    name: 'John Doe'
  }
);

// 5. Connect to LiveKit room
import { Room } from 'livekit-client';

const room = new Room();
await room.connect(serverUrl, token);

console.log('🎉 Connected to session!');
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Your Frontend App                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Dashboard   │  │   Session    │  │    Live      │ │
│  │     UI       │  │   Manager    │  │  Transcript  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                  │                  │         │
│         └──────────────────┴──────────────────┘         │
└────────────────────────┬────────────────┬───────────────┘
                         │                │
                ┌────────▼────────┐  ┌────▼──────────┐
                │  Session Mgmt   │  │    LiveKit    │
                │     Server      │  │    Client     │
                │  (REST API)     │  │   (WebRTC)    │
                └─────────────────┘  └───────────────┘
                         │                  │
                ┌────────▼────────┐  ┌──────▼────────┐
                │   PostgreSQL    │  │  LiveKit      │
                │   (Sessions)    │  │   Server      │
                └─────────────────┘  └───────────────┘
```

### Communication Flow

1. **REST API** → Session Management Server
   - Create/manage projects and sessions
   - Start/stop AI agents
   - Get statistics and timelines

2. **WebRTC** → LiveKit Server
   - Real-time audio communication
   - Data channel for text messages
   - Low-latency bidirectional streaming

## Core Concepts

### Project
Top-level organizational unit. Create one project per application or tenant.

**Example:** "Customer Support", "Healthcare Assessments", "Education Platform"

### Session
One conversation or interaction. Has a unique LiveKit room and timeline.

**Example:** A single user's conversation with an AI agent

### Agent
AI agent running in Kubernetes that joins a session. Processes audio/text and responds.

**Example:** Conversational AI agent with cognitive stimulation plan

### Participant
User or agent connected to a session's LiveKit room.

**Example:** "user-123", "agent-abc456"

## API Patterns

### RESTful Endpoints

All endpoints follow REST conventions:

```
GET    /resource          → List all
POST   /resource          → Create new
GET    /resource/:id      → Get one
DELETE /resource/:id      → Delete

Nested resources:
POST   /parent/:id/child  → Create child under parent
GET    /parent/:id/child  → List children of parent
```

### Pagination

List endpoints support pagination:

```typescript
GET /projects/:id/sessions?skip=0&take=20
```

### Filtering

Filter by status, search, etc:

```typescript
GET /sessions?status=ACTIVE&search=user-123
```

### Responses

Success (200/201):
```json
{
  "id": "...",
  "field": "value"
}
```

Error (4xx/5xx):
```json
{
  "statusCode": 404,
  "timestamp": "2025-10-03T12:00:00Z",
  "path": "/sessions/invalid",
  "message": "Session not found"
}
```

## Common Use Cases

### 1. User Joins Existing Session

```typescript
// Frontend knows sessionId (from URL or state)
const { token, serverUrl } = await api.post(
  `/sessions/${sessionId}/joinToken`,
  { identity: userId, name: userName }
);

const room = new Room();
await room.connect(serverUrl, token);
```

### 2. Create New Session with Agent

```typescript
// Create session
const session = await api.post(`/projects/${projectId}/sessions`);

// Start agent
const agent = await api.post(`/sessions/${session.id}/agents`, {
  role: 'conversational-ai',
  planId: 'cognitive_stimulation_demo_sm'
});

// User joins
const { token, serverUrl } = await api.post(
  `/sessions/${session.id}/joinToken`,
  { identity: userId }
);
```

### 3. Monitor Active Sessions

```typescript
// Poll every 5 seconds
setInterval(async () => {
  const { data } = await api.get(
    `/projects/${projectId}/sessions?status=ACTIVE`
  );
  updateSessionList(data);
}, 5000);
```

### 4. View Session Transcript

```typescript
const { timeline } = await api.get(`/sessions/${sessionId}/timeline?take=100`);

timeline.forEach(item => {
  if (item.type === 'message') {
    displayMessage(item.data);
  } else if (item.type === 'event') {
    displayEvent(item.data);
  }
});
```

## Tech Stack Recommendations

### React

```typescript
// Recommended libraries
- livekit-client
- @tanstack/react-query (API caching)
- zustand (state management)
- tailwindcss (styling)
```

### Vue

```typescript
// Recommended libraries
- livekit-client
- @tanstack/vue-query (API caching)
- pinia (state management)
- tailwindcss (styling)
```

### Vanilla JavaScript

```typescript
// Minimal dependencies
- livekit-client
```

## Development Workflow

1. **Start Session Management Server**
   ```bash
   cd session-management-server
   npm run start:dev
   ```

2. **Start LiveKit Server**
   ```bash
   cd livekit-server
   docker-compose up
   ```

3. **Build AI Agent Image**
   ```bash
   cd conversational-ai-server-python
   docker build -t conversational-ai-server:latest .
   ```

4. **Start Your Frontend**
   ```bash
   npm run dev
   ```

## Environment Variables

```env
# Your .env.local
REACT_APP_API_URL=http://localhost:3000
REACT_APP_LIVEKIT_URL=ws://localhost:7880
```

## Support & Resources

- **Session Management API**: See [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)
- **LiveKit Client**: See [LIVEKIT_INTEGRATION.md](./LIVEKIT_INTEGRATION.md)
- **Types**: See [TYPESCRIPT_TYPES.md](./TYPESCRIPT_TYPES.md)
- **LiveKit Docs**: https://docs.livekit.io/
- **LiveKit Examples**: https://github.com/livekit/livekit-examples

## What's Next?

### Immediate (Available Now)
- ✅ Complete REST API
- ✅ LiveKit token generation
- ✅ Agent deployment
- ✅ Session timelines

### Coming Soon
- 🔜 WebSocket for real-time updates
- 🔜 LiveKit webhook integration
- 🔜 Authentication & authorization
- 🔜 Dashboard UI examples
- 🔜 React/Vue component libraries

### Future
- 📅 Recording & playback
- 📅 Analytics & insights
- 📅 Multi-tenancy
- 📅 Rate limiting
- 📅 Audit logs

---

**Ready to start?** Begin with the [Frontend Integration Guide](./FRONTEND_INTEGRATION.md)!
