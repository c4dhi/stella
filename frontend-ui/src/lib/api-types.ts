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
  planId: string | null
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
  planId?: string // max 255 characters, optional
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
  connectionInfo: ParticipantConnectionInfo
}

export interface ParticipantConnectionInfoResponse {
  participantName: string
  identity: string
  sessionId: string
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
  hostname: string
  platform: string
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
