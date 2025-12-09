// TypeScript types for Session Management Server API
// Based on session-management-server/docs/TYPESCRIPT_TYPES.md

// ============================================================================
// Enums
// ============================================================================

export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED'
}

export enum AgentStatus {
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED'
}

export enum AgentValidationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export type MessageType = 'text' | 'transcript' | 'system' | 'task_update' | 'deliverable' | 'state_change' | 'participant_event'

export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'

// ============================================================================
// Entity Types
// ============================================================================

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ProjectWithCounts extends Project {
  activeSessions: number
  activeAgents: number
  totalSessions: number
}

export interface ProjectWithSessions extends Project {
  sessions: Session[]
}

export interface ProjectStats {
  totalSessions: number
  activeSessions: number
  totalAgents: number
  activeAgents: number
  totalMessages: number
  totalParticipants: number
}

export interface Session {
  id: string
  projectId: string
  name: string | null
  status: SessionStatus
  createdAt: string
  closedAt: string | null
}

export interface Room {
  id: string
  sessionId: string
  livekitRoomName: string
  serverUrl: string
}

export interface SessionWithRoom extends Session {
  room: Room
}

export interface SessionDetail extends SessionWithRoom {
  agents: AgentInstance[]
  participants: Participant[]
  _count: {
    messages: number
    events: number
  }
}

export interface SessionListItem extends SessionWithRoom {
  _count: {
    agents: number
    participants: number
    messages: number
  }
}

export interface AgentInstance {
  id: string
  sessionId: string
  name: string
  icon?: string | null
  status: AgentStatus
  podName: string | null
  secretName: string | null
  configMapName: string | null
  agentConfig: Record<string, unknown> | null
  createdAt: string
  stoppedAt: string | null
}

export interface AgentWithSession extends AgentInstance {
  session: {
    id: string
    room: {
      livekitRoomName: string
      serverUrl: string
    }
  }
}

export interface PodStatus {
  phase: PodPhase
  conditions: any[]
  containerStatuses: any[]
}

export interface AgentWithPodStatus extends AgentWithSession {
  podStatus: PodStatus | null
}

export interface Participant {
  id: string
  sessionId: string
  name: string
  identity: string
  joinedAt: string
  leftAt: string | null
}

export interface Message {
  id: string
  sessionId: string
  participantId: string | null
  content: string
  messageType: MessageType
  category?: string | null  // 'transcript' | 'processing' | 'task_update'
  role?: string | null  // 'user' | 'assistant' | 'system'
  status?: string | null  // 'partial' | 'final'
  metadata?: Record<string, any> | null  // JSON metadata for complex messages
  timestamp: string
  createdAt: string
}

export interface MessageWithParticipant extends Message {
  participant: Participant | null
}

export interface MessagesResponse {
  messages: MessageWithParticipant[]
  hasMore: boolean
  nextCursor: string | null
}

export interface LatestMessagesResponse {
  messages: MessageWithParticipant[]
}

export interface RoomEvent {
  id: string
  sessionId: string
  eventType: string
  data: Record<string, any>
  timestamp: string
}

export type TimelineItem =
  | { type: 'message'; data: MessageWithParticipant }
  | { type: 'event'; data: RoomEvent }

export interface Timeline {
  timeline: TimelineItem[]
  total: number
}

// ============================================================================
// Request DTOs
// ============================================================================

export interface CreateProjectDto {
  name: string // 1-255 characters
}

export interface CreateSessionDto {
  name?: string // max 255 characters, optional
  planId?: string // max 255 characters, optional
}

export interface QuerySessionsDto {
  status?: SessionStatus
  search?: string
  skip?: number // default: 0
  take?: number // default: 20, max: 100
}

export interface CreateTokenDto {
  identity: string // max 255 characters
  name?: string // max 255 characters, optional
}

export interface CreateAgentDto {
  name: string // max 255 characters, required
  icon?: string // max 10 characters (emoji), optional
  agentType?: string // agent type id (e.g., 'stella-agent', 'echo-agent')
  config?: Record<string, unknown> // agent-specific config (e.g., { plan: {...} })
  envVarTemplateId?: string // environment variable template to use
}

export interface AgentType {
  id: string
  slug: string
  name: string
  description: string
  icon: string | null
  version: string
  isBuiltIn: boolean
  capabilities: string[]
  defaultConfig: Record<string, unknown>  // Default config for this agent type
  validationStatus?: AgentValidationStatus
  configSchema?: Record<string, unknown>  // JSON Schema for config options
  resourceGpu?: boolean
  authorName?: string | null
  authorEmail?: string | null
  tags?: string[]
  createdAt?: string
}

// Extended AgentType with build info (for my-agents endpoint)
export interface CustomAgentType extends AgentType {
  lastBuild: {
    status: string
    startedAt: string
    completedAt: string | null
  } | null
}

// Agent package upload response
export interface AgentUploadResponse {
  id: string
  slug: string
  name: string
  version: string
  validationStatus: AgentValidationStatus
  warnings: string[]
}

// Agent build status
export interface AgentBuildStatus {
  id: string
  status: 'pending' | 'building' | 'success' | 'failed'
  imageName?: string
  errorMessage?: string
  startedAt: string
  completedAt?: string
}

// Agent build trigger response
export interface AgentBuildResponse {
  buildLogId: string
  message: string
}

// Package validation result (for showing errors before upload)
export interface PackageValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface SessionEvent {
  type: 'agent.starting' | 'agent.ready' | 'agent.failed' | 'agent.stopped' | 'participant.joined' | 'participant.left'
  sessionId: string
  agentId?: string
  agentName?: string
  agentType?: string
  participantId?: string
  participantIdentity?: string
  participantName?: string
  isOnline?: boolean
  error?: string
  timestamp: string
}

// ============================================================================
// Invitation Types
// ============================================================================

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED'
}

export interface Invitation {
  id: string
  sessionId: string
  token: string
  participantName?: string
  customMessage?: string | null
  visualizerType?: string | null
  visualizerLocked: boolean
  status: InvitationStatus
  createdAt: string
  expiresAt?: string | null
  acceptedAt?: string | null
  participantId?: string | null
  participant?: {
    id: string
    name: string
    identity: string
    joinedAt: string
    leftAt?: string | null
    lastSeenAt?: string | null
  } | null
}

export interface CreateInvitationDto {
  participantName?: string
  customMessage?: string
  visualizerType?: string
  visualizerLocked?: boolean
  expiresInHours?: number
}

export interface CreateInvitationResponse {
  invitation: Invitation
  joinUrl: string
}

export interface InvitationDetails {
  participantName: string
  customMessage?: string | null
  visualizerType?: string | null
  visualizerLocked: boolean
  sessionName?: string | null
  status: InvitationStatus
  // Participant info for rejoin scenarios
  participant?: {
    id: string
    isActive: boolean
  } | null
}

export interface AcceptInvitationResponse {
  participantId: string
  participantName: string
  identity: string
  sessionId: string
  token: string
  connectionInfo: {
    token: string
    serverUrl: string
    roomName: string
  }
  visualizerType?: string | null
  visualizerLocked: boolean
}

// ============================================================================
// Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  skip: number
  take: number
}

export type SessionsResponse = PaginatedResponse<SessionListItem>

export interface JoinTokenResponse {
  token: string
  serverUrl: string
  roomName: string
}

export interface ParticipantConnectionInfo {
  token: string
  serverUrl: string
  roomName: string
  livekitUrl: string
}

export interface RegisterParticipantResponse {
  id: string
  name: string
  identity: string
  token: string // JWT token for participant authentication
  connectionInfo: ParticipantConnectionInfo
}

export interface ParticipantConnectionInfoResponse {
  participantId: string // Participant ID (returned for mobile client)
  participantName: string
  identity: string
  sessionId: string
  token?: string // JWT token (only included for dashboard requests)
  connectionInfo: ParticipantConnectionInfo
}

export interface DeleteResponse {
  message: string
}

export interface ListenerStatus {
  sessionId: string
  sessionStatus: SessionStatus
  listener: {
    isMonitoring: boolean
    isConnected: boolean
    roomState: string
    participantIdentity: string
    reconnectAttempts: number
    remoteParticipants?: number
  }
}

export interface LogEntry {
  timestamp: string
  level: 'log' | 'debug' | 'warn' | 'error'
  message: string
  sessionId?: string
  data?: any
}

export interface MonitoringLogsResponse {
  logs: LogEntry[]
  total: number
  sessionId: string | null
}

export interface NetworkInfoResponse {
  serverUrl: string
  livekitUrl: string
  frontendUrl: string
  hostname: string
  platform: string
  source: string
  environment: string
  detectedIp: string
}

export interface ApiError {
  statusCode: number
  timestamp: string
  path: string
  message: string | string[]
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_PAGINATION = {
  skip: 0,
  take: 20,
} as const

export const MAX_PAGINATION = {
  take: 100,
} as const

export const POLL_INTERVALS = {
  SESSIONS: 5000, // 5 seconds
  AGENTS: 2000, // 2 seconds
  TIMELINE: 3000, // 3 seconds
} as const

// ============================================================================
// Validation Helpers
// ============================================================================

export const validators = {
  projectName: (name: string): boolean => {
    return name.length >= 1 && name.length <= 255
  },

  identity: (identity: string): boolean => {
    return identity.length >= 1 && identity.length <= 255
  },

  pagination: (skip: number, take: number): boolean => {
    return skip >= 0 && take >= 1 && take <= 100
  },
}

// ============================================================================
// Type Guards
// ============================================================================

export function isApiError(error: any): error is ApiError {
  return (
    error &&
    typeof error.statusCode === 'number' &&
    typeof error.timestamp === 'string' &&
    typeof error.path === 'string' &&
    (typeof error.message === 'string' || Array.isArray(error.message))
  )
}

export function isSessionActive(session: Session): boolean {
  return session.status === SessionStatus.ACTIVE
}

export function isAgentRunning(agent: AgentInstance): boolean {
  return agent.status === AgentStatus.RUNNING
}

// ============================================================================
// Plan Template Types (for Plan Builder)
// Canonical format matching stella-ai-agent-sdk/plan
// ============================================================================

/**
 * State execution mode (matches SDK StateType enum)
 * - strict: Sequential task processing - one task at a time
 * - loose: Flexible/parallel task processing - any order
 */
export type StateType = 'strict' | 'loose'

/**
 * @deprecated Use StateType instead. Kept for backward compatibility.
 */
export type ExecutionMode = 'sequential' | 'flexible'

export type DeliverableType = 'string' | 'number' | 'boolean' | 'enum'

/**
 * A single deliverable within a task.
 * Represents a piece of information to collect from the user.
 */
export interface PlanDeliverable {
  key: string                      // Unique identifier (was: id)
  type: DeliverableType
  description: string              // What to collect (was: label)
  required: boolean
  acceptance_criteria?: string     // Validation rules (was: description)
  enum_values?: string[]           // For enum type (was: enumValues)
  examples?: string[]
}

/**
 * A task within a state, containing deliverables.
 */
export interface PlanTask {
  id: string
  description: string              // Task title/name (was: label)
  instruction?: string             // Instructions for agent (was: description)
  required: boolean
  deliverables: PlanDeliverable[]
}

/**
 * State transition definition.
 */
export interface StateTransition {
  target_state_id: string
  condition_type: string           // "all_tasks_complete", "deliverable_value", "deliverable_exists"
  priority?: number
  condition_config?: Record<string, unknown>
}

/**
 * A state in the plan, containing tasks.
 */
export interface PlanState {
  id: string
  title: string                    // Display name (was: label)
  type: StateType                  // Processing mode (was: execution_mode)
  description?: string
  tasks: PlanTask[]
  transitions?: StateTransition[]
}

// Session context field for collecting participant information
export interface SessionContextField {
  id: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  required: boolean
  description?: string
  options?: string[]  // For select type
  default_value?: string | number | boolean  // snake_case for SDK consistency
}

export interface SessionContext {
  fields: SessionContextField[]
}

/**
 * Complete plan content structure.
 *
 * Note: id, title, description, initial_state_id are optional here because
 * they may come from the parent PlanTemplate when stored in the database.
 * When passed to the agent, these should be populated from PlanTemplate fields.
 */
export interface PlanContent {
  id?: string                      // Plan identifier (optional, from template)
  title?: string                   // Plan display name (optional, from template)
  description?: string             // Plan description (optional, from template)
  initial_state_id?: string        // Starting state ID
  states: PlanState[]
  metadata?: Record<string, unknown>
  // Initial prompt configuration
  system_prompt?: string           // Agent persona (snake_case for SDK consistency)
  session_context?: SessionContext
}

export interface PlanTemplate {
  id: string
  userId: string
  name: string
  description?: string
  content: PlanContent
  createdAt: string
  updatedAt: string
}

export interface CreatePlanTemplateDto {
  name: string
  description?: string
  content: PlanContent
}

export interface UpdatePlanTemplateDto {
  name?: string
  description?: string
  content?: PlanContent
}

// ============================================================================
// Plan Generator Types (AI-powered plan generation)
// ============================================================================

export interface GeneratePlanTemplateDto {
  prompt: string
  context?: string
}

export interface GeneratePlanTemplateResponse {
  content: PlanContent
  suggestedName: string
  suggestedDescription: string
}

// ============================================================================
// Environment Variable Template Types
// ============================================================================

export interface EnvVarTemplate {
  id: string
  userId: string
  name: string
  description?: string
  variableKeys: string[]  // Only keys, not values (for security)
  agentTypeId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateEnvVarTemplateDto {
  name: string
  description?: string
  variables: Record<string, string>
  agentTypeId?: string
}

export interface UpdateEnvVarTemplateDto {
  name?: string
  description?: string
  variables?: Record<string, string>
  agentTypeId?: string
}

// ============================================================================
// Agent Requirements (parsed from configSchema)
// ============================================================================

export interface AgentRequirements {
  requiresPlan: boolean
  requiredEnvVars: string[]
}

/**
 * Parse agent requirements from configSchema
 * Looks for:
 * - x-stella-requires-plan: true on any property
 * - x-stella-env-vars: ["VAR1", "VAR2"] at root level
 */
export function parseAgentRequirements(
  configSchema: Record<string, unknown> | null | undefined
): AgentRequirements {
  if (!configSchema) {
    return { requiresPlan: false, requiredEnvVars: [] }
  }

  const properties = (configSchema.properties as Record<string, any>) || {}
  const requiresPlan = Object.values(properties).some(
    (prop: any) => prop?.['x-stella-requires-plan'] === true
  )

  const requiredEnvVars = (configSchema['x-stella-env-vars'] as string[]) || []

  return { requiresPlan, requiredEnvVars }
}
