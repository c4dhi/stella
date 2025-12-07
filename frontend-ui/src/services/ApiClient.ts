// Centralized API client for Session Management Server
// Based on session-management-server/docs/FRONTEND_INTEGRATION.md

import type {
  Project,
  ProjectWithCounts,
  ProjectWithSessions,
  ProjectStats,
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
}

// Export singleton instance
export const apiClient = new SessionManagementClient()

// Export class for testing or custom instances
export { SessionManagementClient }
