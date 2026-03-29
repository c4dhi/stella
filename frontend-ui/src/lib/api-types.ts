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
  agentInactivityTimeoutMinutes?: number | null
}

export interface ProjectWithCounts extends Project {
  activeSessions: number
  activeAgents: number
  totalSessions: number
  isPublic?: boolean
  publicToken?: string
  publicEnabled?: boolean
  ownerId?: string
  isOwner?: boolean
}

export interface ProjectWithSessions extends Project {
  sessions: Session[]
  isPublic?: boolean
  publicToken?: string
  publicEnabled?: boolean
  ownerId?: string
  isOwner?: boolean
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
  agentInactivityTimeoutMinutes?: number | null
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
  envVars?: Record<string, string> // additional env vars to merge with template (overrides template values)
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
  pipelineSchema?: PipelineSchema | null  // Pipeline topology + configurable slots
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
  type:
    | 'agent.starting' | 'agent.ready' | 'agent.failed' | 'agent.stopped'
    | 'participant.joined' | 'participant.left'
    // Join progress types for public project flow
    | 'join.session_created' | 'join.agent_deploying' | 'join.agent_starting'
    | 'join.agent_ready' | 'join.invitation_created' | 'join.complete' | 'join.failed'
    // Project-level session lifecycle events
    | 'session.created' | 'session.closed' | 'session.deleted'
  sessionId: string
  projectId?: string      // For project-level event filtering
  sessionName?: string    // For display in notifications
  agentId?: string
  agentName?: string
  agentType?: string
  participantId?: string
  participantIdentity?: string
  participantName?: string
  isOnline?: boolean
  error?: string
  timestamp: string
  // Join progress fields
  step?: number
  totalSteps?: number
  invitationToken?: string
}

// Project-level session events (for SessionsDashboard real-time updates)
export type ProjectSessionEventType =
  | 'session.created'
  | 'session.closed'
  | 'session.deleted'

export interface ProjectSessionEvent {
  type: ProjectSessionEventType
  sessionId: string
  projectId: string
  sessionName?: string
  timestamp: string
}

// ============================================================================
// Project Metrics Types (for ProjectOverviewBanner)
// ============================================================================

export interface ProjectMetrics {
  projectId: string
  timestamp: string
  sessions: {
    total: number
    active: number
    closed: number
  }
  agents: {
    total: number
    running: number
    starting: number
    failed: number
    stopped: number
  }
  participants: {
    total: number
    online: number
  }
  messages: {
    total: number
    todayCount: number
  }
  project: {
    name: string
    agentType: string | null
    agentTypeName: string | null
    planTemplateName: string | null
    isPublic: boolean
    createdAt: string
  }
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
 * - sequential: Sequential task processing - one task at a time
 * - NOTE: Renamed from "strict" to "sequential" in UI/types (legacy "strict" still normalized at runtime)
 * - NOTE: Renamed from "loose" to "flexible" in UI/types (legacy "loose" still normalized at runtime)
 * - flexible: Flexible/parallel task processing - any order
 * - goal: Goal-oriented natural conversation - agent sees information gaps, not tasks
 */
export type StateType = 'sequential' | 'flexible' | 'goal'

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
  acceptance_criteria?: string     // What constitutes a valid answer, with examples
  enum_values?: string[]           // For enum type (was: enumValues)
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
// Keep this union aligned with backend StateTransition.condition_type in state-machine.service.ts.
export type StateTransitionConditionType =
  | 'all_tasks_complete'
  | 'turn_count_exceeded'
  | 'deliverable_value'
  | 'deliverable_value_in'
  | 'deliverable_value_numeric'
  | 'compound'
  | 'all_of'
  | 'any_of'
  | 'deliverable_exists'

export interface StateTransition {
  target_state_id: string
  condition_type: StateTransitionConditionType
  priority?: number
  condition_config?: Record<string, unknown>
}

/**
 * Goal-mode context for natural, goal-oriented conversation states.
 */
export interface StateGoal {
  objective: string
  context?: string
  depth_guidance?: string
  boundaries?: string
  success_description?: string
  deliverables?: PlanDeliverable[]
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
  goal?: StateGoal                 // Only used when type === 'goal'
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

export interface PlanCanvasPosition {
  x: number
  y: number
}

export interface PlanCanvasMetadata {
  state_positions?: Record<string, PlanCanvasPosition>
  show_end_node?: boolean
  end_node_position?: PlanCanvasPosition
  end_state_ids?: string[]
}

export interface PlanMetadata {
  plan_builder?: {
    canvas?: PlanCanvasMetadata
    [key: string]: unknown
  }
  [key: string]: unknown
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
  metadata?: PlanMetadata
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
  supportsConfigurator: boolean
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
    return { requiresPlan: false, requiredEnvVars: [], supportsConfigurator: false }
  }

  const properties = (configSchema.properties as Record<string, any>) || {}
  const requiresPlan = Object.values(properties).some(
    (prop: any) => prop?.['x-stella-requires-plan'] === true
  )

  const requiredEnvVars = (configSchema['x-stella-env-vars'] as string[]) || []
  const supportsConfigurator = configSchema['x-stella-supports-configurator'] === true

  return { requiresPlan, requiredEnvVars, supportsConfigurator }
}

// ============================================================================
// Public Project Types
// ============================================================================

/**
 * Agent configuration for public projects
 */
export interface PublicAgentConfig {
  name: string
  icon?: string
  plan?: Record<string, unknown>
  config?: Record<string, unknown>
  pipelineConfig?: Record<string, unknown>
  envVarTemplateId?: string
  envVars?: Record<string, string>
}

/**
 * DTO for updating public project configuration
 */
export interface UpdatePublicConfigDto {
  isPublic: boolean
  agentTypeId?: string
  agentConfig?: PublicAgentConfig
  visualizerType?: string
  visualizerLocked?: boolean
  expiresAt?: string
  enabled?: boolean
}

/**
 * Public project info returned from GET /p/:publicToken
 */
export interface PublicProjectInfo {
  projectName: string
  agentName: string
  agentIcon?: string
  visualizerType?: string
  visualizerLocked: boolean
  isExpired: boolean
  isEnabled: boolean
}

/**
 * Response from POST /p/:publicToken/join (blocking/deprecated)
 */
export interface JoinPublicProjectResponse {
  invitationToken: string
  sessionId: string
  agentId: string
}

/**
 * Response from POST /p/:publicToken/start-join (non-blocking)
 * Returns immediately, frontend polls for progress updates
 */
export interface StartJoinPublicProjectResponse {
  sessionId: string
}

/**
 * Response from GET /p/:publicToken/join/:sessionId/status (polling endpoint)
 */
export interface JoinProgressResponse {
  step: number
  totalSteps: number
  status: 'in_progress' | 'complete' | 'failed'
  message: string
  agentId?: string
  invitationToken?: string
  error?: string
}

/**
 * Response from GET /projects/:projectId/public-link
 */
export interface PublicLinkResponse {
  publicLink: string | null
  isEnabled?: boolean
}

/**
 * Extended Project type with public project fields
 */
export interface ProjectWithPublicConfig extends Project {
  isPublic: boolean
  publicToken?: string
  publicAgentTypeId?: string
  publicAgentType?: {
    id: string
    name: string
    slug: string
    icon?: string
  }
  publicAgentConfig?: PublicAgentConfig
  publicVisualizerType?: string
  publicVisualizerLocked: boolean
  publicExpiresAt?: string
  publicEnabled: boolean
}

// ============================================================================
// User Messaging System Types
// ============================================================================

export enum UserMessageType {
  PROJECT_INVITATION = 'PROJECT_INVITATION',
}

export enum ProjectInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

export interface UserMessageMetadata {
  projectId?: string
  projectName?: string
  inviterName?: string
  inviterEmail?: string
  invitationId?: string
}

export interface UserMessage {
  id: string
  type: UserMessageType
  title: string
  body: string | null
  read: boolean
  createdAt: string
  relatedEntityId: string | null
  relatedEntityType: string | null
  metadata?: UserMessageMetadata
}

export interface UnreadCountResponse {
  count: number
}

export interface PaginatedMessagesResponse {
  messages: UserMessage[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// ============================================================================
// Project Collaboration Types
// ============================================================================

export interface Collaborator {
  userId: string
  email: string
  name: string | null
  role: 'OWNER' | 'COLLABORATOR'
  joinedAt: string
}

export interface PendingProjectInvitation {
  invitationId: string
  email: string
  name: string | null
  status: 'PENDING'
  invitedAt: string
}

export interface ProjectCollaboratorsResponse {
  collaborators: Collaborator[]
  pendingInvitations: PendingProjectInvitation[]
}

export interface ProjectInvitationResponse {
  id: string
  projectId: string
  projectName: string
  inviterId: string
  inviterName: string | null
  inviterEmail: string
  inviteeId: string
  inviteeName: string | null
  inviteeEmail: string
  status: string
  createdAt: string
  respondedAt: string | null
}

export interface InviteCollaboratorDto {
  email: string
}

// ============================================================================
// User Notification Event Types (for SSE)
// ============================================================================

export interface UserNotificationEvent {
  type: 'message.created' | 'message.deleted' | 'unread_count.changed'
  userId: string
  message?: UserMessage
  unreadCount?: number
  timestamp: string
}

// ============================================================================
// Transcript Export Types
// ============================================================================

export interface TranscriptExportMeta {
  sessionId: string
  sessionName: string | null
  projectId: string
  projectName: string
  exportedAt: string
  status: 'ACTIVE' | 'CLOSED'
  createdAt: string
  closedAt: string | null
  messageCount: number
  participantCount: number
  deliverableCount?: number
}

export interface TranscriptExportParticipant {
  id: string
  name: string
  identity: string
  joinedAt: string
  leftAt: string | null
}

export interface TranscriptExportAgent {
  id: string
  name: string
  agentType: string | null
  status: string
}

export interface TranscriptExportMessageDeliverable {
  key: string
  value: string
  confidence?: number
  reasoning?: string
}

export interface TranscriptExportMessage {
  id: string
  timestamp: string
  role: string
  messageType: string
  content: string
  speakerName: string | null
  speakerId: string | null
  collectedDeliverables?: TranscriptExportMessageDeliverable[]
}

export interface TranscriptExportDeliverable {
  value: string
  reasoning?: string
  collectedAt?: string
  description?: string
  required?: boolean
}

export interface TranscriptExport {
  meta: TranscriptExportMeta
  participants: TranscriptExportParticipant[]
  agents: TranscriptExportAgent[]
  deliverables?: Record<string, TranscriptExportDeliverable>
  messages: TranscriptExportMessage[]
}

// ============================================================================
// Admin Dashboard Types
// ============================================================================

export interface AdminDashboardMetrics {
  timestamp: string
  activeParticipants: number
  totalParticipants: number
  activeSessions: number
  totalSessions: number
  runningAgents: number
  startingAgents: number
  failedAgents: number
  pausedAgents: number  // Agents paused due to inactivity
  stoppedAgents: number // Agents that are stopped (not paused)
  totalAgents: number
  totalMessages: number
  messagesToday: number
  // Auto-stop feature metrics
  sessionsWithTimeout: number  // Sessions with inactivity timeout configured
}

export interface SessionActivityDay {
  date: string // YYYY-MM-DD
  activeCount: number
  closedCount: number
  errorCount: number
}

export interface HistoricalUsageData {
  date: string
  sessionsCreated: number
  peakParticipants: number
}

export interface GpuDeviceMetrics {
  index: number
  name: string
  usage: number // Percentage 0-100
  memoryUsed: string // BigInt as string
  memoryTotal: string // BigInt as string
  temperature: number | null // Celsius
}

export interface ServerMetrics {
  timestamp: string
  cpuUsage: number
  cpuCores: number
  memoryTotal: string // BigInt as string
  memoryUsed: string
  memoryFree: string
  gpuUsage: number | null
  gpuMemoryUsed: string | null
  gpuMemoryTotal: string | null
  gpuAvailable: boolean
  gpus: GpuDeviceMetrics[] // Per-GPU metrics for all detected GPUs
  k8sNodeCount: number | null
  k8sPodCount: number | null
  k8sCpuRequests: number | null
  k8sMemoryUsed: string | null
}

export interface AdminUserListItem {
  id: string
  email: string
  name: string | null
  verified: boolean
  isSystemAdmin: boolean
  createdAt: string
  projectCount: number
}

export interface AdminUsersResponse {
  users: AdminUserListItem[]
  total: number
  page: number
  totalPages: number
}

export interface SessionResourceUsage {
  cpuMillicores: number
  memoryBytes: number
  cpuPercent: number
  memoryPercent: number
}

export interface SessionAgentError {
  agentName: string
  status: string
  lastError: string | null
  healthState: string | null
}

export interface SessionStatusItem {
  id: string
  status: string // 'ACTIVE', 'CLOSED'
  hasError: boolean
  isIdle: boolean
  resourceUsage: SessionResourceUsage | null
  hasResourceWarning: boolean
  errors: SessionAgentError[]
  projectId: string
  createdAt: string
}

// ============================================================================
// Agent Configurator Types
// ============================================================================

export interface ConfigurableSlot {
  id: string
  label: string
  type: 'text' | 'number' | 'select' | 'string_list' | 'key_value' | 'expert_list'
  description?: string
  default?: unknown
  options?: string[]  // for select type
  min?: number        // for number type
  max?: number        // for number type
  step?: number       // for number type
  maxLength?: number  // for text type
  isCustom?: boolean  // for expert_list type (custom experts)
}

export interface PipelineNode {
  id: string
  label: string
  description?: string
  icon?: string
  position: { row: number; col: number }
  slots: ConfigurableSlot[]
}

export interface PipelineEdge {
  source: string
  target: string
  label?: string
  style?: 'solid' | 'dashed'
}

export interface PipelineThreshold {
  id: string
  label: string
  description?: string
  type: 'number'
  min?: number
  max?: number
  step?: number
  default?: number
}

export interface PipelineSchema {
  nodes: PipelineNode[]
  edges: PipelineEdge[]
  thresholds: PipelineThreshold[]
}

export interface AgentConfigurationPayload {
  nodes?: Record<string, Record<string, unknown>>
  thresholds?: Record<string, unknown>
}

export interface AgentConfiguration {
  id: string
  userId: string
  name: string
  description: string | null
  agentTypeId: string
  agentType?: {
    id: string
    slug: string
    name: string
    icon: string | null
    pipelineSchema?: PipelineSchema | null
  }
  configuration: AgentConfigurationPayload
  agentVersion: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAgentConfigurationDto {
  name: string
  description?: string
  agentTypeId: string
  configuration: AgentConfigurationPayload
  agentVersion?: string
}

export interface UpdateAgentConfigurationDto {
  name?: string
  description?: string
  configuration?: AgentConfigurationPayload
  agentVersion?: string
}
