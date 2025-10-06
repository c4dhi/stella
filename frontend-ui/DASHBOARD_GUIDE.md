# Grace AI Session Management Dashboard

Complete frontend application for managing AI-powered conversational sessions with the Session Management Server.

## 🎯 Overview

This is a multi-level dashboard system that allows users to:

1. **Authenticate** - Login/signup (mock auth for demo)
2. **Manage Projects** - Create and organize projects
3. **Manage Sessions** - Create conversation sessions within projects
4. **Deploy Agents** - Start AI agents to join sessions
5. **Interact** - Real-time voice and text communication

## 🏗️ Architecture

```
/login
  └─ LoginPage with animated background

/dashboard
  └─ ProjectsDashboard
      ├─ Project cards with stats
      └─ Create project modal

/project/:projectId
  └─ SessionsDashboard
      ├─ Session list with filtering
      └─ Create session modal

/session/:sessionId
  └─ SessionView
      ├─ AgentSidebar (left)
      │   ├─ Agent list with status
      │   └─ Deploy agent modal
      ├─ ChatView (center)
      │   ├─ ConnectPanel
      │   ├─ Messages
      │   └─ Composer
      └─ TaskPanel (right)
          ├─ Progress tracking
          └─ Deliverables
```

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+
- Session Management Server running at `http://localhost:3000`
- LiveKit Server running at `ws://localhost:7880`

### 2. Installation

```bash
cd realtime-voice-webrtc-ui
npm install
```

### 3. Configuration

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
VITE_API_URL=http://localhost:3000
VITE_LIVEKIT_URL=ws://localhost:7880
VITE_LIVEKIT_API_KEY=devkey
VITE_LIVEKIT_API_SECRET=secret
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## 🎨 Design System

### Principles

- **Minimalistic**: Jony Ive-inspired clean aesthetics
- **Glass-morphism**: Semi-transparent panels with backdrop blur
- **Smooth Animations**: Framer Motion for fluid transitions
- **Responsive**: Adapts to different screen sizes

### Colors

- Background: `neutral-50` (#fafafa)
- Text: `neutral-900` (dark) / `neutral-500` (light)
- Borders: `neutral-200/60` (semi-transparent)
- Primary: `neutral-900` (black)
- Accents: Green (active), Blue (info), Red (error)

### Typography

- Font: System font stack
- Headings: `font-thin` / `font-light`, `tracking-wide`
- Body: `font-light`, `text-sm`
- Labels: `text-xs`, `uppercase`, `tracking-wider`

### Spacing

- Border Radius: 16px (cards), 12px (buttons)
- Padding: 4-6 spacing units
- Gaps: 3-4 spacing units

## 📦 Key Components

### Authentication

- **LoginPage** (`src/pages/LoginPage.tsx`)
  - Login/signup form
  - Animated particle background (conversational AI theme)
  - Mock authentication (any email/password works)
  - Stores JWT token in localStorage

- **ProtectedRoute** (`src/components/auth/ProtectedRoute.tsx`)
  - Guards routes requiring authentication
  - Redirects to `/login` if not authenticated

### Dashboard Pages

- **ProjectsDashboard** (`src/pages/ProjectsDashboard.tsx`)
  - Grid of project cards
  - Stats: active sessions, active agents, total sessions
  - Create/delete project actions

- **SessionsDashboard** (`src/pages/SessionsDashboard.tsx`)
  - List of sessions for a project
  - Filter by status (ACTIVE/CLOSED)
  - Search functionality
  - Create/close session actions

- **SessionView** (`src/pages/SessionView.tsx`)
  - Three-column layout:
    - Agent sidebar (left)
    - Chat interface (center)
    - Task panel (right, toggleable)

### Agent Management

- **AgentSidebar** (`src/components/agents/AgentSidebar.tsx`)
  - Lists all agents in the session
  - Real-time status polling (2s interval)
  - Deploy/stop agent actions
  - View agent details and logs

- **DeployAgentModal** (`src/components/modals/DeployAgentModal.tsx`)
  - Form to deploy a new agent
  - Fields: role, planId (optional)

### Modals

- **CreateProjectModal** - Create new project with name
- **CreateSessionModal** - Create new session with optional planId
- **DeployAgentModal** - Deploy agent with role and planId

### Animations

- **LoginBackground** (`src/components/animations/LoginBackground.tsx`)
  - Canvas-based particle system
  - Particles form conversational patterns (speech bubbles, sound waves)
  - Mouse interaction with subtle attraction effect
  - Minimal performance impact

## 🔧 API Integration

### API Client

Centralized client in `src/services/ApiClient.ts`:

```typescript
import { apiClient } from './services/ApiClient'

// Projects
await apiClient.createProject({ name: 'My Project' })
await apiClient.listProjects()
await apiClient.getProject(projectId)
await apiClient.deleteProject(projectId)

// Sessions
await apiClient.createSession(projectId, { planId })
await apiClient.listSessions(projectId, { status, search, skip, take })
await apiClient.getSession(sessionId)
await apiClient.closeSession(sessionId)

// Agents
await apiClient.createAgent(sessionId, { role, planId })
await apiClient.getAgent(agentId)
await apiClient.getAgentLogs(agentId)
await apiClient.stopAgent(agentId)

// LiveKit Tokens
await apiClient.createJoinToken(sessionId, { identity, name })
```

### State Management

Using Zustand stores:

- **authStore** (`src/store/authStore.ts`) - Authentication state
- **Main store** (`src/store/index.ts`) - Chat, tasks, media state

## 🎭 User Flow

### 1. Login

1. User visits app (redirected to `/login` if not authenticated)
2. Enters email/password (any combination works in demo mode)
3. Clicks "Sign In" or "Sign Up"
4. Redirected to `/dashboard`

### 2. Create Project

1. On dashboard, click "New Project"
2. Modal appears with name input
3. Enter project name, click "Create Project"
4. New project card appears in grid

### 3. Create Session

1. Click on a project card to view sessions
2. On sessions page, click "New Session"
3. Modal appears with optional planId input
4. Click "Create Session"
5. New session appears in list

### 4. Join Session

1. Click "Open" on a session card
2. Session view loads with three panels
3. Click "Connect" in ConnectPanel to join LiveKit room
4. Microphone activates, ready for communication

### 5. Deploy Agent

1. In session view, left sidebar shows "Active Agents"
2. Click "Deploy Agent"
3. Modal appears with role and planId inputs
4. Enter details (e.g., role: `conversational-ai`, planId: `cognitive_stimulation_demo_sm`)
5. Click "Deploy Agent"
6. Agent appears in sidebar with status "STARTING" → "RUNNING"
7. Agent joins LiveKit room and begins processing

### 6. Manage Agent

- **View Details**: Click "Details" button on agent card
- **View Logs**: Click "Logs" button to see pod logs
- **Stop Agent**: Click red stop icon to terminate agent

## 🔍 Troubleshooting

### Authentication Loop

If you're stuck in a redirect loop:

```bash
# Clear localStorage
localStorage.clear()
```

### Agent Not Starting

- Check Session Management Server logs
- Verify Kubernetes is running
- Check agent pod status via server API

### Connection Issues

- Verify Session Management Server is running (`http://localhost:3000`)
- Verify LiveKit Server is running (`ws://localhost:7880`)
- Check browser console for errors

## 🚀 Production Deployment

### Build

```bash
npm run build
```

Output: `dist/` directory

### Environment Variables

Set production URLs:

```env
VITE_API_URL=https://api.your-domain.com
VITE_LIVEKIT_URL=wss://livekit.your-domain.com
```

### Serve

Use any static file server:

```bash
npm install -g serve
serve -s dist
```

Or deploy to:
- Vercel
- Netlify
- AWS S3 + CloudFront
- Any CDN

## 📝 Development Notes

### Adding New Pages

1. Create page component in `src/pages/`
2. Add route to `src/App.tsx`
3. Wrap with `<ProtectedRoute>` if authentication required

### Styling Guidelines

- Use Tailwind utility classes
- Follow existing component patterns
- Maintain glass-morphism aesthetic:
  - `bg-white/95 backdrop-blur-xl`
  - `border border-neutral-200/60`
  - `rounded-[16px]`
  - `shadow-[0_1px_30px_rgba(0,0,0,0.04)]`

### Animation Guidelines

- Use `framer-motion` for all animations
- Stagger children for list animations
- Duration: 0.3-0.6s
- Easing: `[0.16, 1, 0.3, 1]` (custom bezier)

## 🐛 Known Issues

1. **Mock Authentication**: Current auth is localStorage-based. Implement real JWT auth when backend supports it.

2. **Polling**: Agent status uses polling (2s interval). Consider WebSockets for real-time updates.

3. **Error Handling**: Basic error handling with alerts. Consider toast notifications for better UX.

## 🔮 Future Enhancements

1. **Real Authentication**: Implement proper JWT-based auth with refresh tokens
2. **WebSocket Updates**: Replace polling with WebSocket connections
3. **Recording & Playback**: Add session recording and playback features
4. **Analytics Dashboard**: Add charts and insights for session metrics
5. **Multi-Tenancy**: Add organization/team management
6. **Dark Mode**: Add system-based or manual dark mode toggle
7. **Notifications**: Add in-app notification system for events
8. **Keyboard Shortcuts**: Add keyboard navigation support

---

**Built with ❤️ using React, TypeScript, Tailwind CSS, and Framer Motion**
