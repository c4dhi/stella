# CLAUDE.md — Grace Conversational AI Server (STELLA Backend)

## Project Overview

NestJS-based control plane for conversational AI sessions. Manages AI agent lifecycle, speech services (STT/TTS), and plan-driven conversation state via gRPC and REST APIs. Agents run as Kubernetes pods and communicate with this server over bidirectional gRPC streams.

**Stack:** NestJS 11, PostgreSQL (Prisma), gRPC (protobuf), LiveKit (WebRTC), Kubernetes

**Ports:** HTTP REST on 3000, gRPC on 50051

**Version:** 0.3.0

## Task System Architecture

### Hierarchy: Plan → State → Task → Deliverable

A **Plan** defines a complete conversational workflow as a JSON structure stored in the database (`PlanTemplate` model, executed via `SessionState`).

Each plan contains ordered **States** — discrete conversation phases (e.g., "Greeting", "Collect Info", "Conclusion"). States have a `type` field: `strict` or `loose`.

Each state contains **Tasks** — work units the agent must accomplish (e.g., "Ask user's name"). Tasks can be `required` or optional.

Each task can specify **Deliverables** — concrete values to extract from the user (e.g., key `user_name`, type `string`). Deliverables have `acceptance_criteria` and `examples` to guide LLM evaluation.

**Transitions** define rules for moving between states. Condition types:
- `all_tasks_complete` — all required tasks in current state are done
- `deliverable_value` — a specific deliverable equals an expected value
- `deliverable_exists` — a specific deliverable key has been set

Multiple transitions per state are evaluated by priority (ascending); first match triggers.

### Strict vs Loose Mode

- **Strict:** Sequential task flow. Agent sees current task + next task as preview. Enforces order.
- **Loose:** All pending tasks visible. Agent (LLM) chooses order based on conversation context.

Implementation: `StateMachineService.getPendingTasks()` filters based on `state.type`.

### State Machine Execution

`SessionState` (Prisma model) persists execution state per session:
- `currentStateId` — active state in the plan
- `completedTasks` — array of completed task IDs
- `skippedTasks` — array of skipped task IDs
- `deliverables` — JSON object: `{ key: { value, reasoning, collectedAt } }`
- `turnsWithoutProgress` / `totalTurns` — conversation progress counters

Progress = (completed required items / total required items) × 100, calculated across all states.

## Message Flow

```
User speaks → LiveKit room (WebRTC audio)
  → STT Service (gRPC StreamTranscribe) → transcript text
  → SessionOrchestratorService.handleFinalTranscript()
  → AgentServerService.sendTextInput() → agent pod via gRPC AgentStream
  → Agent processes with LLM, calls state machine RPCs:
      GetPendingTasks / GetPendingDeliverables
      SetDeliverable(key, value, reasoning)
      CompleteTask(taskId, reasoning)
  → StateMachineService evaluates transitions, updates progress
  → Agent sends AgentOutputProto(TEXT_FINAL) back via stream
  → SessionOrchestratorService.handleTextFinal() → triggers TTS
  → TTS Service (gRPC SynthesizeStream) → audio
  → LiveKit room → user hears response
```

## How Agents Evaluate Messages Against Tasks

Agents are **LLM-based, not rule-based**. The agent (Python, running in a K8s pod):

1. Calls `GetPendingDeliverables()` to get what to collect (key, description, type, acceptance_criteria, examples)
2. Receives user text from the gRPC stream
3. Uses an LLM to extract values from the message and match them to deliverables
4. Validates extracted values against acceptance criteria
5. Calls `SetDeliverable(key, value, reasoning)` for each extracted value
6. The server-side state machine handles the rest: auto-completing tasks when all required deliverables are collected, evaluating transitions, advancing states

For tasks without deliverables, the agent calls `CompleteTask(taskId, reasoning)` directly.

`IncrementTurn()` is called when no progress is made in a turn, tracked via `turnsWithoutProgress`.

## Agent Types

Three agent implementations in `agents/`:

| Agent | Description |
|-------|-------------|
| `stella-agent` | Full pipeline agent with InputGate/ExpertPool/Aggregator architecture |
| `stella-light-agent` | Lightweight single-LLM agent with tool-based state management. Supports tool mode (recommended) and legacy text-parsing mode |
| `echo-agent` | Simple echo/test agent for development |
| `stella-ai-agent-sdk` | Shared Python SDK library used by all agents |

Agent types are registered in the `AgentType` model and discovered automatically by `BuiltinAgentDiscoveryService` scanning `agents/` directories for `agent.yaml` manifests. Custom agents can be uploaded and built via the agent package/build pipeline.

## gRPC Services

### Agent Service (`proto/agent.proto`)

- `RegisterAgent` — agent pod registers with session
- `AgentStream` — bidirectional stream; server sends `AgentInputProto` (TEXT, INTERRUPT, SESSION_START, SESSION_END, CONFIG, HEALTH_CHECK), agent sends `AgentOutputProto` (TEXT_CHUNK, TEXT_FINAL, STATUS, METADATA, ERROR, HEALTH_STATUS)
- `SendInterrupt` — user barge-in
- `EndSession` / `HealthCheck`

### State Machine Service (`proto/state_machine.proto`)

- `Initialize` — set up plan for session
- `CompleteTask` / `SetDeliverable` — mark progress (returns success, taskCompleted, transitioned, newStateId, progress)
- `GetCurrentState` / `GetPendingTasks` / `GetPendingDeliverables` — query execution state
- `IncrementTurn` — track turns without progress
- `GetCollectedDeliverables` / `GetFullState` — query collected data

### Speech Services

- **STT** (`proto/stt.proto`): `StreamTranscribe(AudioChunk stream) → TranscriptEvent stream`, `Warmup(WarmupRequest) → WarmupResponse`, `HealthCheck`. AudioChunk includes `sample_rate`. TranscriptEvent includes `speech_started` for VAD.
- **TTS** (`proto/tts.proto`): `Synthesize`, `SynthesizeStream(SynthesizeRequest) → AudioChunk stream`, `HealthCheck`

## Key Files

### Core Services

| File | Role |
|------|------|
| `src/main.ts` | Bootstrap — starts HTTP (3000) and gRPC (50051) servers |
| `src/state-machine/state-machine.service.ts` | `StateMachineService` — plan execution, task/deliverable tracking, transition evaluation |
| `src/state-machine/state-machine-grpc.controller.ts` | gRPC endpoints for state machine |
| `src/agent-server/agent-server.service.ts` | `AgentServerService` — manages agent connections and streams |
| `src/agent-server/agent-session-stream.ts` | `AgentSessionStream` — handles a single agent's bidirectional gRPC stream |
| `src/agent-server/session-orchestrator.service.ts` | `SessionOrchestratorService` — coordinates STT → agent → TTS message flow |
| `src/agent-server/agent-grpc.controller.ts` | gRPC endpoints for agent communication |
| `src/agent-server/agent-health-monitor.service.ts` | `AgentHealthMonitorService` — user-presence-aware health checks (5s interval, 3 failures → ERROR) |
| `src/sessions/sessions.service.ts` | `SessionsService` — session CRUD, message storage, SSE events |
| `src/agents/agents.service.ts` | `AgentsService` — agent lifecycle (start/stop/logs via Kubernetes) |
| `src/livekit/livekit.service.ts` | `LiveKitService` — JWT token generation for LiveKit rooms |
| `src/webhooks/` | `WebhooksService` — LiveKit webhook handling, agent pause/resume on inactivity, recorder management |

### Agent Infrastructure

| File | Role |
|------|------|
| `src/agent-image/` | `AgentImageService` — Docker image building/caching, supports local and K3s environments |
| `src/agent-registry/` | `BuiltinAgentDiscoveryService` — discovers built-in agents from `agents/` directory manifests |
| `src/agent-build/` | `AgentBuildService` — custom agent Docker builds |
| `src/agent-package/` | `AgentPackageService` — agent package management and manifest validation |
| `src/agent-upload/` | `AgentUploadController` / `AgentAdminController` — agent upload and admin endpoints |
| `src/agent-type/` | `AgentTypeService` — agent type CRUD and registry |

### Supporting Modules

| File | Role |
|------|------|
| `src/kubernetes/` | `KubernetesService` — K8s pod management |
| `src/metrics/` | `MetricsService` — real-time metrics streaming via SSE |
| `src/plan-templates/` | `PlanTemplatesService` / `PlanGeneratorService` — reusable plan template CRUD |
| `src/env-var-templates/` | `EnvVarTemplatesService` / `EncryptionService` — encrypted environment variable templates (AES-256-GCM) |
| `src/storage/` | `StorageService` — file storage abstraction |
| `src/transcript-processor/` | Transcript processing pipeline (PassthroughProcessor) |
| `src/message-recorder/` | Message recording service for sessions |
| `src/projects/` | Project CRUD and membership management |
| `src/public-projects/` | Public project sharing functionality |
| `src/project-invitations/` | Project collaboration invitations |
| `src/invitations/` | Session participant invitations |
| `src/user-messages/` | User inbox/messaging system |
| `src/auth/` | JWT authentication, passport strategies |

### Data Models (`prisma/schema.prisma`)

| Model | Role |
|-------|------|
| `SessionState` | Plan execution state (current state, completed tasks, deliverables, turn counters) |
| `Session` | Session record with room + agent references |
| `AgentInstance` | Deployed agent pod (name, config, health, status, gRPC address) |
| `AgentType` | Agent registry — built-in + custom, with validation workflow, resource limits, config schema |
| `AgentBuildLog` | Docker build logs for custom agents |
| `Message` | Conversation messages with metadata |
| `PlanTemplate` | Reusable plan definitions (per user) |
| `EnvVarTemplate` | Encrypted env var templates (AES-256-GCM) scoped to user/agent type |
| `Room` | LiveKit room mapping to session |
| `Participant` | Session participants with presence tracking |
| `Invitation` | Shareable session join links with status tracking |
| `Project` | Project with public sharing config and membership |
| `ProjectMembership` | User-project role associations (OWNER/ADMIN/MEMBER) |
| `ProjectInvitation` | Project collaboration invitations |
| `UserMessage` | User inbox messages (polymorphic entity references) |

### Proto Definitions (`proto/`)

| File | Service |
|------|---------|
| `proto/agent.proto` | AgentService — RegisterAgent, AgentStream, SendInterrupt, EndSession |
| `proto/state_machine.proto` | StateMachineService — Initialize, CompleteTask, SetDeliverable, Get* |
| `proto/stt.proto` | SpeechToText — StreamTranscribe, Warmup, HealthCheck |
| `proto/tts.proto` | TextToSpeech — Synthesize, SynthesizeStream, HealthCheck |

## Build & Run

```bash
npm install          # Install dependencies
npx prisma generate  # Generate Prisma client
npm run start:dev    # Development server
npm run db:seed      # Compile and run database seed
npm test             # Run unit tests
npm run test:e2e     # Run end-to-end tests
```

Kubernetes deployment: `./scripts/start-k8s.sh` (supports `--production`, `--daemon`, `--rebuild`, `--stop`)
