// Centralized API client for Session Management Server
// Based on session-management-server/docs/FRONTEND_INTEGRATION.md

import type {
  Project,
  ProjectWithCounts,
  ProjectWithSessions,
  ProjectStats,
  ProjectMetrics,
  CreateProjectDto,
  SessionWithRoom,
  SessionDetail,
  SessionListItem,
  CreateSessionDto,
  QuerySessionsDto,
  PaginatedResponse,
  JoinTokenResponse,
  CreateTokenDto,
  Timeline,
  AgentInstance,
  AgentWithPodStatus,
  CreateAgentDto,
  AgentType,
  CustomAgentType,
  AgentUploadResponse,
  AgentBuildStatus,
  AgentBuildResponse,
  SessionEvent,
  ProjectSessionEvent,
  DeleteResponse,
  ApiError,
  Participant,
  RegisterParticipantResponse,
  ParticipantConnectionInfoResponse,
  MessagesResponse,
  LatestMessagesResponse,
  ListenerStatus,
  MonitoringLogsResponse,
  NetworkInfoResponse,
  Invitation,
  CreateInvitationDto,
  CreateInvitationResponse,
  InvitationDetails,
  AcceptInvitationResponse,
  PlanTemplate,
  CreatePlanTemplateDto,
  UpdatePlanTemplateDto,
  GeneratePlanTemplateDto,
  GeneratePlanTemplateResponse,
  EnvVarTemplate,
  CreateEnvVarTemplateDto,
  UpdateEnvVarTemplateDto,
  UpdatePublicConfigDto,
  PublicProjectInfo,
  JoinPublicProjectResponse,
  StartJoinPublicProjectResponse,
  JoinProgressResponse,
  PublicLinkResponse,
  ProjectWithPublicConfig,
  UserMessage,
  UnreadCountResponse,
  PaginatedMessagesResponse,
  ProjectCollaboratorsResponse,
  ProjectInvitationResponse,
  UserNotificationEvent,
} from '../lib/api-types'
import { getRuntimeConfig } from '../config/runtime'

class SessionManagementClient {
  private pendingRequests: Map<string, Promise<any>> = new Map()

  constructor() {
    // No initialization needed - baseUrl is fetched lazily
  }

  // ============================================================================
  // HTTP Helper Methods
  // ============================================================================

  /**
   * Get base URL from runtime config (lazy evaluation)
   * This ensures we always use the correct URL even if config loads after construction
   */
  private getBaseUrl(): string {
    return getRuntimeConfig().apiUrl
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`

    // Get JWT token from localStorage (check new key first, then old for migration)
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add Authorization header if token exists
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Merge with any existing headers from options
    if (options.headers) {
      Object.assign(headers, options.headers)
    }

    const response = await fetch(url, {
      ...options,
      headers,
    })

    // Handle 401 Unauthorized - redirect to login
    if (response.status === 401) {
      // Clear stored auth data
      localStorage.removeItem('stella_auth_token')
      localStorage.removeItem('stella_user')
      localStorage.removeItem('grace_auth_token')
      localStorage.removeItem('grace_user')

      // Redirect to login page
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }

      const error: ApiError = {
        statusCode: 401,
        timestamp: new Date().toISOString(),
        path,
        message: 'Session expired. Please login again.',
      }
      throw error
    }

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path,
          message: response.statusText,
        }
      }
      throw errorData
    }

    // Handle empty responses (e.g., 204 No Content)
    if (response.status === 204) {
      return {} as T
    }

    return response.json()
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  private async post<T>(path: string, data?: any): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  private async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }

  // ============================================================================
  // Projects API
  // ============================================================================

  async createProject(data: CreateProjectDto): Promise<Project> {
    return this.post<Project>('/projects', data)
  }

  async listProjects(): Promise<ProjectWithCounts[]> {
    return this.get<ProjectWithCounts[]>('/projects')
  }

  async getProject(projectId: string): Promise<ProjectWithSessions> {
    return this.get<ProjectWithSessions>(`/projects/${projectId}`)
  }

  async getProjectStats(projectId: string): Promise<ProjectStats> {
    return this.get<ProjectStats>(`/projects/${projectId}/stats`)
  }

  async updateProject(projectId: string, data: { name: string }): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteProject(projectId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/projects/${projectId}`)
  }

  /**
   * Update public project configuration
   */
  async updateProjectPublicConfig(
    projectId: string,
    data: UpdatePublicConfigDto
  ): Promise<ProjectWithPublicConfig> {
    return this.request<ProjectWithPublicConfig>(
      `/projects/${projectId}/public-config`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    )
  }

  /**
   * Get public link for a project
   */
  async getProjectPublicLink(projectId: string): Promise<PublicLinkResponse> {
    return this.get<PublicLinkResponse>(`/projects/${projectId}/public-link`)
  }

  // ============================================================================
  // Public Project API (No auth required)
  // ============================================================================

  /**
   * Get public project info by token (no auth required)
   * Used for the waiting screen before joining
   */
  async getPublicProject(publicToken: string): Promise<PublicProjectInfo> {
    const url = `${this.getBaseUrl()}/p/${publicToken}`
    const response = await fetch(url)

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/p/${publicToken}`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Join a public project (no auth required) - BLOCKING/DEPRECATED
   * Creates session, deploys agent, waits for ready, creates invitation
   * Returns invitation token for redirect to /join/:invitationToken
   * @deprecated Use startJoinPublicProject with subscribeToJoinProgress instead
   */
  async joinPublicProject(publicToken: string): Promise<JoinPublicProjectResponse> {
    const url = `${this.getBaseUrl()}/p/${publicToken}/join`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/p/${publicToken}/join`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Start joining a public project (no auth required) - NON-BLOCKING
   * Creates session and deploys agent, returns immediately with sessionId
   * Poll getJoinProgress for status updates
   */
  async startJoinPublicProject(publicToken: string): Promise<StartJoinPublicProjectResponse> {
    const url = `${this.getBaseUrl()}/p/${publicToken}/start-join`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/p/${publicToken}/start-join`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Get join progress status (no auth required) - POLLING
   * Returns current step, status, and invitationToken when complete
   */
  async getJoinProgress(publicToken: string, sessionId: string): Promise<JoinProgressResponse> {
    const url = `${this.getBaseUrl()}/p/${publicToken}/join/${sessionId}/status`
    const response = await fetch(url)

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/p/${publicToken}/join/${sessionId}/status`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Subscribe to join progress events via SSE (no auth required)
   * Events: join.session_created, join.agent_deploying, join.agent_starting,
   *         join.agent_ready, join.invitation_created, join.complete, join.failed
   * Returns cleanup function to close the EventSource connection.
   * @deprecated Use getJoinProgress polling instead for more reliable updates
   */
  subscribeToJoinProgress(
    publicToken: string,
    sessionId: string,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    const url = `${this.getBaseUrl()}/p/${publicToken}/join/${sessionId}/events`

    // No auth needed for public endpoints
    const eventSource = new EventSource(url)

    eventSource.onmessage = (e) => {
      try {
        const event: SessionEvent = JSON.parse(e.data)
        onEvent(event)
      } catch (err) {
        console.error('[ApiClient] Failed to parse join progress event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] Join progress SSE connection error:', e)
      if (onError) {
        onError(e)
      }
    }

    // Return cleanup function
    return () => {
      eventSource.close()
    }
  }

  // ============================================================================
  // Sessions API
  // ============================================================================

  async createSession(
    projectId: string,
    data: CreateSessionDto = {}
  ): Promise<SessionWithRoom> {
    return this.post<SessionWithRoom>(`/projects/${projectId}/sessions`, data)
  }

  async listSessions(
    projectId: string,
    query: QuerySessionsDto = {}
  ): Promise<PaginatedResponse<SessionListItem>> {
    const params = new URLSearchParams()

    if (query.status) params.append('status', query.status)
    if (query.search) params.append('search', query.search)
    if (query.skip !== undefined) params.append('skip', query.skip.toString())
    if (query.take !== undefined) params.append('take', query.take.toString())

    const queryString = params.toString()
    const path = `/projects/${projectId}/sessions${queryString ? `?${queryString}` : ''}`

    return this.get<PaginatedResponse<SessionListItem>>(path)
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    return this.get<SessionDetail>(`/sessions/${sessionId}`)
  }

  async createJoinToken(
    sessionId: string,
    data: CreateTokenDto
  ): Promise<JoinTokenResponse> {
    return this.post<JoinTokenResponse>(
      `/sessions/${sessionId}/joinToken`,
      data
    )
  }

  async getTimeline(
    sessionId: string,
    skip?: number,
    take?: number
  ): Promise<Timeline> {
    const params = new URLSearchParams()
    if (skip !== undefined) params.append('skip', skip.toString())
    if (take !== undefined) params.append('take', take.toString())

    const queryString = params.toString()
    const path = `/sessions/${sessionId}/timeline${queryString ? `?${queryString}` : ''}`

    return this.get<Timeline>(path)
  }

  async updateSession(sessionId: string, data: { name?: string }): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async closeSession(sessionId: string): Promise<DeleteResponse> {
    return this.request<DeleteResponse>(`/sessions/${sessionId}/close`, {
      method: 'PATCH',
    })
  }

  async deleteSession(sessionId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/sessions/${sessionId}`)
  }

  // ============================================================================
  // Agents API
  // ============================================================================

  async getAgentTypes(): Promise<AgentType[]> {
    return this.get<AgentType[]>('/agent-types')
  }

  async createAgent(
    sessionId: string,
    data: CreateAgentDto
  ): Promise<AgentInstance> {
    return this.post<AgentInstance>(`/sessions/${sessionId}/agents`, data)
  }

  async getAgent(agentId: string): Promise<AgentWithPodStatus> {
    return this.get<AgentWithPodStatus>(`/agents/${agentId}`)
  }

  async getAgentLogs(agentId: string): Promise<string> {
    // Get JWT token from localStorage
    const token = localStorage.getItem('grace_auth_token')

    // Build headers with Authorization
    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.getBaseUrl()}/agents/${agentId}/logs`, {
      headers,
    })

    // Handle 401 Unauthorized - redirect to login
    if (response.status === 401) {
      localStorage.removeItem('grace_auth_token')
      localStorage.removeItem('grace_user')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
      throw new Error('Session expired. Please login again.')
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch agent logs: ${response.statusText}`)
    }

    return response.text()
  }

  async stopAgent(agentId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/agents/${agentId}`)
  }

  async deleteAgent(agentId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/agents/${agentId}/permanent`)
  }

  async restartAgent(agentId: string): Promise<AgentInstance> {
    return this.post<AgentInstance>(`/agents/${agentId}/restart`)
  }

  // ============================================================================
  // Participant Management
  // ============================================================================

  async registerParticipant(sessionId: string, name: string): Promise<RegisterParticipantResponse> {
    return this.post<RegisterParticipantResponse>(`/sessions/${sessionId}/participants`, { name })
  }

  async listParticipants(sessionId: string): Promise<Participant[]> {
    return this.get<Participant[]>(`/sessions/${sessionId}/participants`)
  }

  async getParticipantConnectionInfo(participantId: string): Promise<ParticipantConnectionInfoResponse> {
    return this.get<ParticipantConnectionInfoResponse>(`/participants/${participantId}/connection-info`)
  }

  async removeParticipant(participantId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/participants/${participantId}`)
  }

  /**
   * Send heartbeat to update participant presence.
   * Uses a custom auth token (participant JWT) instead of the organizer token.
   */
  async participantHeartbeat(authToken: string): Promise<{ success: boolean; lastSeenAt: string }> {
    const response = await fetch(`${this.getBaseUrl()}/participants/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Heartbeat failed' }))
      throw error
    }

    return response.json()
  }

  /**
   * Fetch message history for a participant.
   * Uses a custom auth token (participant JWT) instead of the organizer token.
   *
   * By default, excludes debug/processing messages for a cleaner chat experience.
   * Set includeDebug: true to include debug messages.
   */
  async getParticipantMessages(
    sessionId: string,
    authToken: string,
    options: {
      limit?: number
      cursor?: string
      before?: string  // ISO timestamp - load messages before this time (for pagination)
      includeDebug?: boolean  // Include debug/processing messages (default: false)
    } = {}
  ): Promise<MessagesResponse> {
    const params = new URLSearchParams()
    if (options.limit) params.append('limit', options.limit.toString())
    if (options.cursor) params.append('cursor', options.cursor)
    if (options.before) params.append('before', options.before)
    // By default, exclude debug messages for cleaner chat experience
    params.append('include_debug', options.includeDebug ? 'true' : 'false')

    const queryString = params.toString()
    const path = `/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`

    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch messages' }))
      throw error
    }

    return response.json()
  }

  // ============================================================================
  // Invitations API
  // ============================================================================

  async createInvitation(
    sessionId: string,
    data: CreateInvitationDto
  ): Promise<CreateInvitationResponse> {
    return this.post<CreateInvitationResponse>(
      `/sessions/${sessionId}/invitations`,
      data
    )
  }

  async listInvitations(sessionId: string): Promise<Invitation[]> {
    return this.get<Invitation[]>(`/sessions/${sessionId}/invitations`)
  }

  async getInvitation(invitationId: string): Promise<Invitation> {
    return this.get<Invitation>(`/invitations/${invitationId}`)
  }

  async revokeInvitation(invitationId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/invitations/${invitationId}/revoke`)
  }

  async deleteInvitation(invitationId: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/invitations/${invitationId}`)
  }

  // ============================================================================
  // Public Invitation API (No auth required)
  // ============================================================================

  /**
   * Get public invitation details by token (no auth required)
   */
  async getPublicInvitation(token: string): Promise<InvitationDetails> {
    const url = `${this.getBaseUrl()}/join/${token}`
    const response = await fetch(url)

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/join/${token}`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Accept invitation and join session (no auth required)
   */
  async acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
    const url = `${this.getBaseUrl()}/join/${token}/accept`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/join/${token}/accept`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  /**
   * Rejoin an already accepted invitation (no auth required)
   */
  async rejoinInvitation(token: string): Promise<AcceptInvitationResponse> {
    const url = `${this.getBaseUrl()}/join/${token}/rejoin`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      let errorData: ApiError
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          timestamp: new Date().toISOString(),
          path: `/join/${token}/rejoin`,
          message: response.statusText,
        }
      }
      throw errorData
    }

    return response.json()
  }

  // ============================================================================
  // Messages API
  // ============================================================================

  async getSessionMessages(
    sessionId: string,
    options: {
      cursor?: string
      limit?: number
      before?: string
    } = {}
  ): Promise<MessagesResponse> {
    // Create unique key for request deduplication
    const requestKey = `messages-${sessionId}-${options.cursor || 'initial'}-${options.limit || 50}`

    // Return existing pending request if one exists
    if (this.pendingRequests.has(requestKey)) {
      console.debug('[ApiClient] Returning cached request for', requestKey)
      return this.pendingRequests.get(requestKey)!
    }

    const params = new URLSearchParams()

    if (options.cursor) params.append('cursor', options.cursor)
    if (options.limit) params.append('limit', options.limit.toString())
    if (options.before) params.append('before', options.before)

    const queryString = params.toString()
    const path = `/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`

    const promise = this.get<MessagesResponse>(path)
      .finally(() => {
        // Clean up after request completes (success or failure)
        this.pendingRequests.delete(requestKey)
        console.debug('[ApiClient] Cleaned up request cache for', requestKey)
      })

    this.pendingRequests.set(requestKey, promise)
    return promise
  }

  async getLatestMessages(
    sessionId: string,
    since: string
  ): Promise<LatestMessagesResponse> {
    return this.get<LatestMessagesResponse>(
      `/sessions/${sessionId}/messages/latest?since=${encodeURIComponent(since)}`
    )
  }

  /**
   * Download transcript for a session as a JSON file.
   * Triggers a browser download of the complete conversation transcript.
   */
  async downloadTranscript(
    sessionId: string,
    options?: { includeDebug?: boolean; includeMetadata?: boolean }
  ): Promise<void> {
    const params = new URLSearchParams()
    if (options?.includeDebug) params.append('includeDebug', 'true')
    if (options?.includeMetadata) params.append('includeMetadata', 'true')

    const queryString = params.toString()
    const path = `/sessions/${sessionId}/transcript${queryString ? `?${queryString}` : ''}`

    // Get JWT token from localStorage
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      let errorData: any
      try {
        errorData = await response.json()
      } catch {
        errorData = {
          statusCode: response.status,
          message: response.statusText,
        }
      }
      throw errorData
    }

    // Get filename from Content-Disposition header or generate a default
    const contentDisposition = response.headers.get('Content-Disposition')
    let filename = `transcript-${sessionId}.json`
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="(.+)"/)
      if (match) {
        filename = match[1]
      }
    }

    // Trigger browser download
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ============================================================================
  // Listener Monitoring API
  // ============================================================================

  async getListenerStatus(sessionId: string): Promise<ListenerStatus> {
    return this.get<ListenerStatus>(`/sessions/${sessionId}/listener-status`)
  }

  async getMonitoringLogs(sessionId?: string): Promise<MonitoringLogsResponse> {
    const params = sessionId ? `?sessionId=${sessionId}` : ''
    return this.get<MonitoringLogsResponse>(`/monitoring/logs${params}`)
  }

  // ============================================================================
  // Network Info API
  // ============================================================================

  async getNetworkInfo(): Promise<NetworkInfoResponse> {
    return this.get<NetworkInfoResponse>('/network-info')
  }

  // ============================================================================
  // SSE Session Events API
  // ============================================================================

  /**
   * Subscribe to real-time session events (agent ready, failed, etc.)
   * Returns cleanup function to close the EventSource connection.
   */
  subscribeToSessionEvents(
    sessionId: string,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    const url = `${this.getBaseUrl()}/sessions/${sessionId}/events`

    // Get auth token
    const token = localStorage.getItem('grace_auth_token')

    // For SSE, we need to pass auth token via query param since EventSource doesn't support headers
    const urlWithAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url

    const eventSource = new EventSource(urlWithAuth)

    eventSource.onmessage = (e) => {
      try {
        const event: SessionEvent = JSON.parse(e.data)
        onEvent(event)
      } catch (err) {
        console.error('[ApiClient] Failed to parse SSE event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] SSE connection error:', e)
      if (onError) {
        onError(e)
      }
    }

    // Return cleanup function
    return () => {
      eventSource.close()
    }
  }

  /**
   * Subscribe to real-time project events (session created, closed, deleted).
   * Used by SessionsDashboard for real-time updates when new participants join.
   * Returns cleanup function to close the EventSource connection.
   */
  subscribeToProjectEvents(
    projectId: string,
    onEvent: (event: ProjectSessionEvent) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void
  ): () => void {
    const url = `${this.getBaseUrl()}/projects/${projectId}/sessions/events`

    // Get auth token
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    // For SSE, we need to pass auth token via query param since EventSource doesn't support headers
    const urlWithAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url

    const eventSource = new EventSource(urlWithAuth)

    eventSource.onopen = () => {
      console.log(`[ApiClient] SSE connection opened for project ${projectId}`)
      onOpen?.()
    }

    eventSource.onmessage = (e) => {
      try {
        const event: ProjectSessionEvent = JSON.parse(e.data)
        onEvent(event)
      } catch (err) {
        console.error('[ApiClient] Failed to parse project SSE event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] Project SSE connection error:', e)
      onError?.(e)
    }

    // Return cleanup function
    return () => {
      console.log(`[ApiClient] Closing SSE connection for project ${projectId}`)
      eventSource.close()
    }
  }

  // ============================================================================
  // Project Metrics API
  // ============================================================================

  /**
   * Get current metrics snapshot for a project.
   * Includes session counts, agent status, participant counts, and message stats.
   */
  async getProjectMetrics(projectId: string): Promise<ProjectMetrics> {
    return this.request<ProjectMetrics>(`/metrics/projects/${projectId}`)
  }

  /**
   * Subscribe to real-time project metrics via SSE.
   * Receives updates every 5 seconds or immediately when data changes.
   * Returns cleanup function to close the EventSource connection.
   */
  subscribeToProjectMetrics(
    projectId: string,
    onData: (metrics: ProjectMetrics) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void
  ): () => void {
    const url = `${this.getBaseUrl()}/metrics/projects/${projectId}/stream`

    // Get auth token
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    // For SSE, we need to pass auth token via query param since EventSource doesn't support headers
    const urlWithAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url

    const eventSource = new EventSource(urlWithAuth)

    eventSource.onopen = () => {
      console.log(`[ApiClient] Metrics SSE connection opened for project ${projectId}`)
      onOpen?.()
    }

    eventSource.onmessage = (e) => {
      try {
        const metrics: ProjectMetrics = JSON.parse(e.data)
        onData(metrics)
      } catch (err) {
        console.error('[ApiClient] Failed to parse metrics SSE event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] Metrics SSE connection error:', e)
      onError?.(e)
    }

    // Return cleanup function
    return () => {
      console.log(`[ApiClient] Closing metrics SSE connection for project ${projectId}`)
      eventSource.close()
    }
  }

  // ============================================================================
  // Custom Agent Upload API
  // ============================================================================

  /**
   * Upload a custom agent package (zip file).
   */
  async uploadAgentPackage(file: File): Promise<AgentUploadResponse> {
    const formData = new FormData()
    formData.append('file', file)

    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    const headers: Record<string, string> = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.getBaseUrl()}/agent-types/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw error
    }

    return response.json()
  }

  /**
   * Get the current user's custom agents.
   */
  async getMyAgents(): Promise<CustomAgentType[]> {
    return this.get<CustomAgentType[]>('/agent-types/my-agents')
  }

  /**
   * Trigger a build for a custom agent.
   */
  async triggerAgentBuild(agentTypeId: string): Promise<AgentBuildResponse> {
    return this.post<AgentBuildResponse>(`/agent-types/${agentTypeId}/build`)
  }

  /**
   * Get build status for an agent.
   */
  async getAgentBuildStatus(agentTypeId: string): Promise<AgentBuildStatus | null> {
    return this.get<AgentBuildStatus | null>(`/agent-types/${agentTypeId}/build-status`)
  }

  /**
   * Get build history for an agent.
   */
  async getAgentBuildHistory(agentTypeId: string): Promise<AgentBuildStatus[]> {
    return this.get<AgentBuildStatus[]>(`/agent-types/${agentTypeId}/build-history`)
  }

  /**
   * Delete a custom agent.
   */
  async deleteCustomAgent(agentTypeId: string): Promise<{ success: boolean }> {
    return this.post<{ success: boolean }>(`/agent-types/${agentTypeId}/delete`)
  }

  /**
   * Subscribe to build logs via SSE.
   * Returns cleanup function to close the EventSource connection.
   */
  subscribeToBuildLogs(
    agentTypeId: string,
    onLog: (data: { status: string; output?: string; errorMessage?: string }) => void,
    onError?: (error: Event) => void
  ): () => void {
    const url = `${this.getBaseUrl()}/agent-types/${agentTypeId}/build-logs`
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')
    const urlWithAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url

    const eventSource = new EventSource(urlWithAuth)

    eventSource.onmessage = (e) => {
      try {
        if (e.data && e.data !== 'connected' && e.data !== 'no_build') {
          const data = JSON.parse(e.data)
          onLog(data)
        }
      } catch (err) {
        console.error('[ApiClient] Failed to parse build log event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] Build log SSE connection error:', e)
      if (onError) {
        onError(e)
      }
    }

    return () => {
      eventSource.close()
    }
  }

  // ============================================================================
  // Plan Templates API
  // ============================================================================

  /**
   * List all plan templates for the current user.
   */
  async listPlanTemplates(): Promise<PlanTemplate[]> {
    return this.get<PlanTemplate[]>('/plan-templates')
  }

  /**
   * Get a single plan template by ID.
   */
  async getPlanTemplate(id: string): Promise<PlanTemplate> {
    return this.get<PlanTemplate>(`/plan-templates/${id}`)
  }

  /**
   * Create a new plan template.
   */
  async createPlanTemplate(data: CreatePlanTemplateDto): Promise<PlanTemplate> {
    return this.post<PlanTemplate>('/plan-templates', data)
  }

  /**
   * Update an existing plan template.
   */
  async updatePlanTemplate(id: string, data: UpdatePlanTemplateDto): Promise<PlanTemplate> {
    return this.request<PlanTemplate>(`/plan-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /**
   * Delete a plan template.
   */
  async deletePlanTemplate(id: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/plan-templates/${id}`)
  }

  /**
   * Duplicate a plan template.
   */
  async duplicatePlanTemplate(id: string): Promise<PlanTemplate> {
    return this.post<PlanTemplate>(`/plan-templates/${id}/duplicate`)
  }

  /**
   * Generate a plan template using AI.
   */
  async generatePlanTemplate(data: GeneratePlanTemplateDto): Promise<GeneratePlanTemplateResponse> {
    return this.post<GeneratePlanTemplateResponse>('/plan-templates/generate', data)
  }

  // ============================================================================
  // Environment Variable Templates API
  // ============================================================================

  /**
   * List all environment variable templates for the current user.
   * Optionally filter by agent type.
   */
  async listEnvVarTemplates(agentTypeId?: string): Promise<EnvVarTemplate[]> {
    const query = agentTypeId ? `?agentTypeId=${agentTypeId}` : ''
    return this.get<EnvVarTemplate[]>(`/env-var-templates${query}`)
  }

  /**
   * Get a single environment variable template by ID.
   */
  async getEnvVarTemplate(id: string): Promise<EnvVarTemplate> {
    return this.get<EnvVarTemplate>(`/env-var-templates/${id}`)
  }

  /**
   * Create a new environment variable template.
   */
  async createEnvVarTemplate(data: CreateEnvVarTemplateDto): Promise<EnvVarTemplate> {
    return this.post<EnvVarTemplate>('/env-var-templates', data)
  }

  /**
   * Update an existing environment variable template.
   */
  async updateEnvVarTemplate(id: string, data: UpdateEnvVarTemplateDto): Promise<EnvVarTemplate> {
    return this.request<EnvVarTemplate>(`/env-var-templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  /**
   * Delete an environment variable template.
   */
  async deleteEnvVarTemplate(id: string): Promise<DeleteResponse> {
    return this.delete<DeleteResponse>(`/env-var-templates/${id}`)
  }

  /**
   * Duplicate an environment variable template.
   */
  async duplicateEnvVarTemplate(id: string): Promise<EnvVarTemplate> {
    return this.post<EnvVarTemplate>(`/env-var-templates/${id}/duplicate`)
  }

  // ============================================================================
  // User Messages API (Inbox)
  // ============================================================================

  /**
   * Get paginated messages for the current user.
   */
  async getMessages(params?: { page?: number; limit?: number }): Promise<PaginatedMessagesResponse> {
    const queryParams = new URLSearchParams()
    if (params?.page) queryParams.append('page', params.page.toString())
    if (params?.limit) queryParams.append('limit', params.limit.toString())
    const query = queryParams.toString()
    return this.get<PaginatedMessagesResponse>(`/user/messages${query ? `?${query}` : ''}`)
  }

  /**
   * Get unread message count for the current user.
   */
  async getUnreadMessageCount(): Promise<UnreadCountResponse> {
    return this.get<UnreadCountResponse>('/user/messages/unread-count')
  }

  /**
   * Mark a message as read.
   */
  async markMessageAsRead(messageId: string): Promise<UserMessage> {
    return this.request<UserMessage>(`/user/messages/${messageId}/read`, {
      method: 'PATCH',
    })
  }

  /**
   * Delete a message.
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.delete<void>(`/user/messages/${messageId}`)
  }

  /**
   * Subscribe to real-time user notification events via SSE.
   * Events: message.created, message.deleted, unread_count.changed
   * Returns cleanup function to close the EventSource connection.
   */
  subscribeToUserNotifications(
    onEvent: (event: UserNotificationEvent) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void
  ): () => void {
    const url = `${this.getBaseUrl()}/user/messages/events`

    // Get auth token
    const token = localStorage.getItem('stella_auth_token') || localStorage.getItem('grace_auth_token')

    // For SSE, pass auth token via query param since EventSource doesn't support headers
    const urlWithAuth = token ? `${url}?token=${encodeURIComponent(token)}` : url

    const eventSource = new EventSource(urlWithAuth)

    eventSource.onopen = () => {
      console.log('[ApiClient] User notifications SSE connection opened')
      onOpen?.()
    }

    eventSource.onmessage = (e) => {
      try {
        const event: UserNotificationEvent = JSON.parse(e.data)
        onEvent(event)
      } catch (err) {
        console.error('[ApiClient] Failed to parse user notification event:', err)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[ApiClient] User notifications SSE connection error:', e)
      onError?.(e)
    }

    // Return cleanup function
    return () => {
      console.log('[ApiClient] Closing user notifications SSE connection')
      eventSource.close()
    }
  }

  // ============================================================================
  // Project Collaborators API
  // ============================================================================

  /**
   * Get all collaborators and pending invitations for a project.
   */
  async getProjectCollaborators(projectId: string): Promise<ProjectCollaboratorsResponse> {
    return this.get<ProjectCollaboratorsResponse>(`/projects/${projectId}/collaborators`)
  }

  /**
   * Invite a user to collaborate on a project.
   */
  async inviteCollaborator(projectId: string, email: string): Promise<ProjectInvitationResponse> {
    return this.post<ProjectInvitationResponse>(
      `/projects/${projectId}/collaborators/invite`,
      { email }
    )
  }

  /**
   * Remove a collaborator from a project.
   */
  async removeCollaborator(projectId: string, userId: string): Promise<void> {
    await this.delete<void>(`/projects/${projectId}/collaborators/${userId}`)
  }

  /**
   * Cancel a pending invitation.
   */
  async cancelProjectInvitation(invitationId: string): Promise<void> {
    await this.delete<void>(`/project-invitations/${invitationId}`)
  }

  /**
   * Accept a project invitation.
   */
  async acceptProjectInvitation(invitationId: string): Promise<ProjectInvitationResponse> {
    return this.post<ProjectInvitationResponse>(`/project-invitations/${invitationId}/accept`)
  }

  /**
   * Decline a project invitation.
   */
  async declineProjectInvitation(invitationId: string): Promise<void> {
    await this.post<void>(`/project-invitations/${invitationId}/decline`)
  }
}

// Export singleton instance
export const apiClient = new SessionManagementClient()

// Export class for testing or custom instances
export { SessionManagementClient }
