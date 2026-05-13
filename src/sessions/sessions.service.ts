import { Injectable, NotFoundException, UnauthorizedException, ForbiddenException, BadRequestException, Logger, forwardRef, Inject } from '@nestjs/common';
import { Observable, Subject, ReplaySubject, filter, map, finalize } from 'rxjs';
import { OnEvent } from '@nestjs/event-emitter';
import { TokenVerifier } from 'livekit-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { AgentsService } from '../agents/agents.service';
import { RoomMonitorService, type LogEntry } from '../message-recorder/room-monitor.service';
import { AuthService } from '../auth/auth.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { Prisma } from '@prisma/client';
import type { PlanData, DeliverableValue } from '../state-machine/state-machine.service';

/** Deliverable entry in the transcript summary section */
interface TranscriptDeliverableSummaryEntry {
  value: unknown;
  reasoning?: string;
  collectedAt?: string;
  description?: string;
  required?: boolean;
}

/** Deliverable attached to a specific user message in the transcript */
interface TranscriptMessageDeliverable {
  key: string;
  value: unknown;
  reasoning?: string;
}

// Session event types for SSE streaming
export interface SessionEvent {
  type:
    | 'agent.starting' | 'agent.ready' | 'agent.failed' | 'agent.stopped'
    | 'participant.joined' | 'participant.left'
    // Join progress types for public project flow
    | 'join.session_created' | 'join.agent_deploying' | 'join.agent_starting'
    | 'join.agent_ready' | 'join.invitation_created' | 'join.complete' | 'join.failed'
    // Project-level session lifecycle events
    | 'session.created' | 'session.closed' | 'session.deleted';
  sessionId: string;
  projectId?: string;      // For project-level event filtering
  sessionName?: string;    // For display in notifications
  agentId?: string;
  agentName?: string;
  agentType?: string;
  participantId?: string;
  participantIdentity?: string;
  participantName?: string;
  isOnline?: boolean;
  error?: string;
  timestamp: string;
  // Join progress fields
  step?: number;
  totalSteps?: number;
  invitationToken?: string;
}

interface MessageEvent {
  data: string;
  id?: string;
  type?: string;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private connectedSessions: Set<string> = new Set(); // Track Python recorder connections
  private lastStatusUpdate: Date = new Date();

  // Event subjects for SSE streaming per session
  private sessionEventSubjects: Map<string, Subject<SessionEvent> | ReplaySubject<SessionEvent>> = new Map();
  private subscriberCounts: Map<string, number> = new Map();

  // Event subjects for SSE streaming per project (session lifecycle events)
  private projectEventSubjects: Map<string, ReplaySubject<SessionEvent>> = new Map();
  private projectSubscriberCounts: Map<string, number> = new Map();

  constructor(
    private prisma: PrismaService,
    private livekit: LiveKitService,
    @Inject(forwardRef(() => AgentsService))
    private agentsService: AgentsService,
    private roomMonitor: RoomMonitorService,
    private authService: AuthService,
  ) {}

  async create(projectId: string, createSessionDto: CreateSessionDto) {
    // Generate unique room name
    const roomName = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Fetch project to inherit agentInactivityTimeoutMinutes
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { agentInactivityTimeoutMinutes: true },
    });

    const session = await this.prisma.session.create({
      data: {
        projectId,
        name: createSessionDto.name,
        // Message-recorder optimization: recorder should join immediately when session is created
        // This ensures messages are captured before any participants join
        recorderShouldJoin: true,
        // Agent spawn mode: 'immediate' (default) or 'on_demand' (for public projects)
        agentSpawnMode: createSessionDto.agentSpawnMode || 'immediate',
        // Inherit agent inactivity timeout from project
        agentInactivityTimeoutMinutes: project?.agentInactivityTimeoutMinutes ?? null,
        room: {
          create: {
            livekitRoomName: roomName,
            serverUrl: this.livekit.getPublicServerUrl(),
          },
        },
      },
      include: {
        room: true,
        _count: {
          select: {
            agents: true,
            participants: true,
            messages: true,
          },
        },
      },
    });

    // Message recording is now handled by the Python message recorder service
    // which automatically discovers and monitors all active sessions
    this.logger.log(`Session ${session.id} created - will be auto-discovered by message recorder`);

    // Emit session.created event for real-time dashboard updates
    this.emitSessionCreated({
      id: session.id,
      projectId: session.projectId,
      name: session.name,
      room: session.room || undefined,
    });

    return session;
  }

  async findAll(projectId: string, query: QuerySessionsDto) {
    const where: Prisma.SessionWhereInput = {
      projectId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { room: { livekitRoomName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        include: {
          room: true,
          _count: {
            select: {
              agents: true,
              participants: true,
              messages: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.session.count({ where }),
    ]);

    return {
      data: sessions,
      total,
      skip: query.skip,
      take: query.take,
    };
  }

  async findOne(id: string) {
    this.logger.debug(`findOne: Looking up session ${id}`);

    try {
      const session = await this.prisma.session.findUnique({
        where: { id },
        include: {
          room: true,
          agents: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          participants: {
            where: {
              leftAt: null,
            },
            orderBy: {
              joinedAt: 'desc',
            },
          },
          _count: {
            select: {
              messages: true,
              events: true,
            },
          },
        },
      });

      if (!session) {
        this.logger.warn(`findOne: Session ${id} not found`);
        throw new NotFoundException(`Session with ID ${id} not found`);
      }

      this.logger.debug(`findOne: Found session ${id} with ${session.agents?.length || 0} agents`);

      // Sync agent statuses from Kubernetes (only when session is actively viewed)
      if (session.agents && session.agents.length > 0) {
        this.logger.debug(`Syncing status for ${session.agents.length} agents in session ${id}`);

        // Sync all agents in parallel
        await Promise.all(
          session.agents.map(async (agent) => {
            try {
              const updatedStatus = await this.agentsService.syncAgentStatus(agent.id);
              if (updatedStatus && updatedStatus !== agent.status) {
                // Update the in-memory agent object with the synced status
                agent.status = updatedStatus;
              }
            } catch (error) {
              this.logger.warn(`Failed to sync agent ${agent.id}: ${error.message}`);
            }
          })
        );
      }

      return session;
    } catch (error) {
      this.logger.error(`findOne: Error fetching session ${id}: ${error.message}`);
      this.logger.error(`findOne: Stack trace: ${error.stack}`);
      throw error;
    }
  }

  async createJoinToken(sessionId: string, createTokenDto: CreateTokenDto) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (!session.room) {
      throw new Error('Session does not have an associated room');
    }

    const token = await this.livekit.createToken(
      session.room.livekitRoomName,
      createTokenDto.identity,
      createTokenDto.name,
    );

    // Use current PUBLIC_LIVEKIT_URL instead of database value
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    return {
      token,
      serverUrl: publicLivekitUrl,
      roomName: session.room.livekitRoomName,
    };
  }

  async getTimeline(sessionId: string, skip: number = 0, take: number = 50) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const [messages, events] = await Promise.all([
      this.prisma.message.findMany({
        where: { sessionId },
        orderBy: {
          timestamp: 'desc',
        },
        skip,
        take,
      }),
      this.prisma.roomEvent.findMany({
        where: { sessionId },
        orderBy: {
          timestamp: 'desc',
        },
        skip,
        take,
      }),
    ]);

    // Merge and sort by timestamp
    const timeline = [
      ...messages.map((m) => ({ type: 'message', data: m })),
      ...events.map((e) => ({ type: 'event', data: e })),
    ].sort((a, b) => {
      const timeA = a.data.timestamp.getTime();
      const timeB = b.data.timestamp.getTime();
      return timeB - timeA;
    });

    return {
      timeline: timeline.slice(0, take),
      total: messages.length + events.length,
    };
  }

  async update(id: string, updateSessionDto: UpdateSessionDto) {
    const session = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }

    await this.prisma.session.update({
      where: { id },
      data: updateSessionDto,
    });

    // Return full session detail to match frontend expectations
    return this.findOne(id);
  }

  async close(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }

    this.logger.log(`Closing session ${id} - stopping all agents`);

    // Stop all running agents using centralized function
    await this.agentsService.stopAllSessionAgents(id);

    // Revoke all pending/accepted invitations
    const revokedInvitations = await this.prisma.invitation.updateMany({
      where: {
        sessionId: id,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      data: { status: 'REVOKED' },
    });

    if (revokedInvitations.count > 0) {
      this.logger.log(
        `Session ${id}: auto-revoked ${revokedInvitations.count} invitation(s)`,
      );
    }

    // Mark all participants as left
    const updatedParticipants = await this.prisma.participant.updateMany({
      where: {
        sessionId: id,
        leftAt: null,
      },
      data: { leftAt: new Date() },
    });

    if (updatedParticipants.count > 0) {
      this.logger.log(
        `Session ${id}: marked ${updatedParticipants.count} participant(s) as left`,
      );
    }

    // Python message recorder will automatically stop monitoring when session becomes CLOSED
    this.logger.log(`Session ${id} cleanup complete - updating session status to CLOSED`);

    await this.prisma.session.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });

    // Emit session.closed event for real-time dashboard updates
    this.emitSessionClosed(id, session.projectId, session.name);

    return { message: 'Session closed successfully' };
  }

  async delete(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }

    // Capture session info before deletion for event emission
    const projectId = session.projectId;
    const sessionName = session.name;

    this.logger.log(`Deleting session ${id} - stopping all agents and removing all data`);

    // Stop all running agents using centralized function
    await this.agentsService.stopAllSessionAgents(id);

    // Delete the session (Prisma cascade will delete Room, Participants, Messages, Events, AgentInstances)
    await this.prisma.session.delete({
      where: { id },
    });

    // Emit session.deleted event for real-time dashboard updates
    this.emitSessionDeleted(id, projectId, sessionName);

    this.logger.log(`Session ${id} deleted - all agents stopped, all data removed`);
    return { message: 'Session deleted successfully' };
  }

  // Participant management methods
  async registerParticipant(sessionId: string, name: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (!session.room) {
      throw new Error('Session does not have an associated room');
    }

    // Generate unique identity for this participant
    const identity = `participant-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Create participant in database
    const participant = await this.prisma.participant.create({
      data: {
        sessionId,
        name,
        identity,
        isManuallyRegistered: true, // Mark as manually registered
        lastTokenRefresh: new Date(), // Set initial token refresh timestamp
      },
    });

    // Generate LiveKit token for this participant
    const livekitToken = await this.livekit.createToken(
      session.room.livekitRoomName,
      identity,
      name,
    );

    // Generate participant JWT for API authentication
    const participantToken = this.authService.generateParticipantToken(
      participant.id,
      sessionId,
    );

    // Use current PUBLIC_LIVEKIT_URL instead of database value
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    return {
      id: participant.id,
      name: participant.name,
      identity: participant.identity,
      token: participantToken, // JWT token for API authentication
      connectionInfo: {
        token: livekitToken, // LiveKit token for room connection
        serverUrl: publicLivekitUrl,
        roomName: session.room.livekitRoomName,
        livekitUrl: publicLivekitUrl,
      },
    };
  }

  async listParticipants(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    return this.prisma.participant.findMany({
      where: {
        sessionId,
        isManuallyRegistered: true, // Only show manually registered participants
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });
  }

  /**
   * Get participant connection info with JWT token (for dashboard)
   * Generates a fresh participant JWT token for QR code generation
   */
  async getParticipantConnectionInfoWithToken(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        session: {
          include: {
            room: true,
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundException(`Participant with ID ${participantId} not found`);
    }

    if (!participant.session.room) {
      throw new Error('Participant session does not have an associated room');
    }

    // Generate fresh LiveKit token
    const livekitToken = await this.livekit.createToken(
      participant.session.room.livekitRoomName,
      participant.identity,
      participant.name,
    );

    // Generate fresh participant JWT for API authentication
    const participantToken = this.authService.generateParticipantToken(
      participant.id,
      participant.sessionId,
    );

    // Use current PUBLIC_LIVEKIT_URL instead of database value
    // This ensures network-accessible URLs even if room was created before PUBLIC_LIVEKIT_URL was set
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    return {
      participantId: participant.id,
      participantName: participant.name,
      identity: participant.identity,
      sessionId: participant.sessionId,
      token: participantToken, // JWT token for QR code
      connectionInfo: {
        token: livekitToken,
        serverUrl: publicLivekitUrl,
        roomName: participant.session.room.livekitRoomName,
        livekitUrl: publicLivekitUrl,
      },
    };
  }

  /**
   * Get participant connection info (for mobile app)
   * Mobile app is already authenticated with participant JWT
   * This endpoint is used for token refresh
   */
  async getParticipantConnectionInfo(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        session: {
          include: {
            room: true,
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundException(`Participant with ID ${participantId} not found`);
    }

    // Check if token has been revoked
    if (participant.tokenRevokedAt) {
      throw new UnauthorizedException(`Participant access has been revoked`);
    }

    if (!participant.session.room) {
      throw new Error('Participant session does not have an associated room');
    }

    // Update lastTokenRefresh timestamp
    await this.prisma.participant.update({
      where: { id: participantId },
      data: { lastTokenRefresh: new Date() },
    });

    // Generate fresh LiveKit token with 24h TTL
    const livekitToken = await this.livekit.createToken(
      participant.session.room.livekitRoomName,
      participant.identity,
      participant.name,
      '24h', // 24-hour TTL for auto-refresh
    );

    // Use current PUBLIC_LIVEKIT_URL instead of database value
    // This ensures network-accessible URLs even if room was created before PUBLIC_LIVEKIT_URL was set
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    return {
      participantId: participant.id, // Include participantId in response for mobile client
      participantName: participant.name,
      identity: participant.identity,
      sessionId: participant.sessionId,
      connectionInfo: {
        token: livekitToken,
        serverUrl: publicLivekitUrl,
        roomName: participant.session.room.livekitRoomName,
        livekitUrl: publicLivekitUrl,
      },
    };
  }

  async removeParticipant(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException(`Participant with ID ${participantId} not found`);
    }

    // Soft delete: revoke token instead of deleting participant
    // This prevents future token refreshes and maintains audit trail
    await this.prisma.participant.update({
      where: { id: participantId },
      data: {
        tokenRevokedAt: new Date(),
        leftAt: new Date(), // Also mark as left for UI purposes
      },
    });

    this.logger.log(`Participant ${participantId} token revoked and marked as left`);

    return { message: 'Participant removed successfully' };
  }

  /**
   * Update participant heartbeat - updates lastSeenAt timestamp.
   * Called periodically by participant clients to maintain presence.
   */
  async participantHeartbeat(participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
    });

    if (!participant) {
      throw new NotFoundException(`Participant with ID ${participantId} not found`);
    }

    if (participant.tokenRevokedAt) {
      throw new BadRequestException('Participant token has been revoked');
    }

    await this.prisma.participant.update({
      where: { id: participantId },
      data: { lastSeenAt: new Date() },
    });

    return { success: true, lastSeenAt: new Date().toISOString() };
  }

  // Message retrieval methods
  async getMessages(
    sessionId: string,
    options: {
      cursor?: string;
      limit?: number;
      before?: string;
      includeDebug?: boolean;
    } = {},
  ) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const limit = options.limit || 50;

    // Define message types to include (matching getChatHistory logic)
    const chatMessageTypes = [
      'user_text', 'transcript', 'transcript_chunk', 'agent_text',
      'participant_joined', 'participant_left', 'participant_event'
    ];
    const debugMessageTypes = [
      'debug', 'decision_stream', 'expert_status', 'prompt_execution',
      'safety_check', 'plan_progress_update', 'plan_deliverable_update',
      'state_change_notification', 'complete_todo_list', 'llm_config',
      'task_progress_update', 'progress_update', 'task_update'
    ];

    const messageTypes = options.includeDebug
      ? [...chatMessageTypes, ...debugMessageTypes]
      : chatMessageTypes;

    // Cursor is now a timestamp (ISO string) instead of a UUID.
    // UUID-based cursoring (`id < cursor`) is broken for random UUIDs (non-sequential).
    const where: Prisma.MessageWhereInput = {
      sessionId,
      messageType: { in: messageTypes },
      ...(options.before && { timestamp: { lt: new Date(options.before) } }),
      ...(options.cursor && { timestamp: { lt: new Date(options.cursor) } }),
    };

    // Fetch one extra to determine if there are more messages
    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const results = hasMore ? messages.slice(0, -1) : messages;

    // Cursor is the oldest message's timestamp for the next page
    const oldestResult = results[results.length - 1];
    const nextCursor = hasMore && oldestResult
      ? oldestResult.timestamp.toISOString()
      : null;

    return {
      messages: results.reverse(), // Return in ascending order (oldest first)
      hasMore,
      nextCursor,
    };
  }

  async getMessagesSince(sessionId: string, since: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    const messages = await this.prisma.message.findMany({
      where: {
        sessionId,
        timestamp: { gt: new Date(since) },
      },
      orderBy: { timestamp: 'asc' },
    });

    return { messages };
  }

  // Get listener status for a session
  async getListenerStatus(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Check if Python recorder is actually connected to this session
    const isConnected = this.connectedSessions.has(sessionId);
    const timeSinceUpdate = Date.now() - this.lastStatusUpdate.getTime();
    const isStale = timeSinceUpdate > 30000; // Consider stale if no update in 30s

    return {
      sessionId,
      sessionStatus: session.status,
      listener: {
        // Recorder should keep monitoring while session is transitioning to CLOSED.
        isMonitoring: session.status === 'ACTIVE' || session.status === 'CLOSING',
        isConnected: isConnected && !isStale,
        roomState: isConnected && !isStale ? 'connected' : 'not_connected',
        service: 'python-message-recorder',
        lastUpdate: this.lastStatusUpdate.toISOString(),
        note: isStale ? 'Status may be stale - recorder may be restarting' : undefined,
      },
    };
  }

  // Get batch listener status for multiple sessions
  async getBatchListenerStatus(sessionIds: string[]) {
    if (sessionIds.length === 0) {
      return [];
    }

    // Fetch all sessions in a single query
    const sessions = await this.prisma.session.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, status: true },
    });

    const timeSinceUpdate = Date.now() - this.lastStatusUpdate.getTime();
    const isStale = timeSinceUpdate > 30000; // Consider stale if no update in 30s

    // Map sessions to listener status format
    return sessions.map((session) => {
      const isConnected = this.connectedSessions.has(session.id);
      return {
        sessionId: session.id,
        sessionStatus: session.status,
        listener: {
          // Recorder should keep monitoring while session is transitioning to CLOSED.
          isMonitoring: session.status === 'ACTIVE' || session.status === 'CLOSING',
          isConnected: isConnected && !isStale,
          roomState: isConnected && !isStale ? 'connected' : 'not_connected',
          service: 'python-message-recorder',
          lastUpdate: this.lastStatusUpdate.toISOString(),
          note: isStale ? 'Status may be stale - recorder may be restarting' : undefined,
        },
      };
    });
  }

  // Get monitoring logs
  async getMonitoringLogs(sessionId?: string): Promise<{
    logs: LogEntry[];
    total: number;
    sessionId: string | null;
  }> {
    // Return logs from the legacy Node.js monitor (if any exist)
    // For live monitoring, check Python message-recorder pod logs
    const logs = this.roomMonitor.getLogs(sessionId);
    return {
      logs,
      total: logs.length,
      sessionId: sessionId || null,
    };
  }

  // Get global monitoring status
  async getMonitoringStatus() {
    // Get all sessions that should still be monitored by recorder.
    const activeSessions = await this.prisma.session.findMany({
      where: { status: { in: ['ACTIVE', 'CLOSING'] } },
      select: {
        id: true,
        status: true,
        room: {
          select: {
            livekitRoomName: true,
          },
        },
      },
    });

    // All active sessions are monitored by Python service
    const sessionsWithStatus = activeSessions.map(session => ({
      sessionId: session.id,
      roomName: session.room?.livekitRoomName,
      sessionStatus: session.status,
      isMonitoring: true,
      listener: {
        service: 'python-message-recorder',
        isConnected: true,
        roomState: 'monitored_by_python_service',
        note: 'Check message-recorder pod logs for details',
      },
    }));

    return {
      totalActiveSessions: activeSessions.length,
      totalMonitoredSessions: activeSessions.length,
      service: 'python-message-recorder',
      sessions: sessionsWithStatus,
    };
  }

  // ============================================================================
  // Internal API Methods (for Python message recorder service)
  // ============================================================================

  /**
   * Store a log entry from the Python message recorder.
   * Logs are stored in the RoomMonitorService buffer for display in UI.
   */
  async storeMonitoringLog(logData: {
    level: 'log' | 'debug' | 'warn' | 'error';
    message: string;
    sessionId?: string;
    data?: any;
  }) {
    this.roomMonitor.addLog(
      logData.level,
      logData.message,
      logData.sessionId,
      logData.data,
    );
    return { success: true };
  }

  /**
   * Update monitoring status from Python message recorder.
   * Receives list of actively connected session IDs.
   */
  async updateMonitoringStatus(statusData: {
    connectedSessions: string[];
  }) {
    this.connectedSessions = new Set(statusData.connectedSessions);
    this.lastStatusUpdate = new Date();
    this.logger.debug(`Updated monitoring status: ${statusData.connectedSessions.length} connected sessions`);
    return { success: true, receivedAt: this.lastStatusUpdate.toISOString() };
  }

  /**
   * Store participant join/leave event.
   * Creates a message in the timeline for conversation playback.
   */
  async storeParticipantEvent(
    sessionId: string,
    eventData: {
      eventType: 'joined' | 'left';
      participantIdentity: string;
      participantName?: string;
    },
  ) {
    // Validate session exists
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      this.logger.warn(`Participant event for non-existent session: ${sessionId}`);
      return { success: false, error: 'Session not found' };
    }

    // Create message for the event
    const content = eventData.eventType === 'joined'
      ? `${eventData.participantName || eventData.participantIdentity} joined the session`
      : `${eventData.participantName || eventData.participantIdentity} left the session`;

    const message = await this.prisma.message.create({
      data: {
        sessionId,
        content,
        role: 'system',
        status: 'final',
        messageType: `participant_${eventData.eventType}`,
        metadata: {
          participantIdentity: eventData.participantIdentity,
          participantName: eventData.participantName,
          eventType: eventData.eventType,
        },
      },
    });

    this.logger.debug(
      `Stored participant ${eventData.eventType} event for ${eventData.participantIdentity} in session ${sessionId}`,
    );

    return { success: true, messageId: message.id };
  }

  /**
   * Find all active sessions that need monitoring.
   * Returns sessions still expected to have recorder monitoring.
   * Used by Python message recorder to discover which rooms to join.
   */
  async findActiveSessions() {
    const sessions = await this.prisma.session.findMany({
      where: {
        status: { in: ['ACTIVE', 'CLOSING'] },
      },
      include: {
        room: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return sessions;
  }

  /**
   * Find rooms that the message recorder should join.
   * Used by smart sync mode - only joins rooms with actual participants.
   * Returns sessions where recorderShouldJoin = true and shutdown is not finalized.
   */
  async findRoomsToJoin(): Promise<{
    sessionId: string;
    roomName: string;
    hasHumanParticipant: boolean;
    priority: 'high' | 'normal';
  }[]> {
    const sessions = await this.prisma.session.findMany({
      where: {
        status: { in: ['ACTIVE', 'CLOSING'] },
        recorderShouldJoin: true,
      },
      include: {
        room: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return sessions
      .filter(s => s.room) // Only sessions with rooms
      .map(session => ({
        sessionId: session.id,
        roomName: session.room!.livekitRoomName,
        hasHumanParticipant: session.hasHumanParticipant,
        // High priority if human is present (for immediate message capture)
        priority: session.hasHumanParticipant ? 'high' as const : 'normal' as const,
      }));
  }

  /**
   * Update session's recorder join state.
   * Called by webhooks when participants join/leave.
   */
  async updateRecorderJoinState(
    sessionId: string,
    shouldJoin: boolean,
    humanPresent?: boolean,
  ): Promise<void> {
    const updateData: any = {
      recorderShouldJoin: shouldJoin,
    };

    if (humanPresent !== undefined) {
      updateData.hasHumanParticipant = humanPresent;
      if (humanPresent) {
        updateData.humanJoinedAt = new Date();
        updateData.humanLeftAt = null;
      } else {
        updateData.humanLeftAt = new Date();
      }
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: updateData,
    });

    this.logger.log(`Updated session ${sessionId}: recorderShouldJoin=${shouldJoin}, humanPresent=${humanPresent}`);
  }

  /**
   * Store a recorded message from the Python message recorder.
   * Simplified approach: Store the complete envelope as-is for perfect replay.
   */
  async storeRecordedMessage(
    sessionId: string,
    messageEnvelope: any,
    participantIdentity?: string,
    participantName?: string,
  ) {
    // Verify session exists
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    // Extract message type
    const messageType = messageEnvelope.type || 'unknown';

    // Skip messages from the recorder itself
    if (participantIdentity === 'message-recorder') {
      return { success: true, stored: false, reason: 'recorder_message_skipped' };
    }

    // Determine message role based on participant identity
    let role: string;
    if (!participantIdentity) {
      role = 'system';
    } else if (participantIdentity.startsWith('agent-')) {
      role = 'assistant';
    } else {
      role = 'user';
    }

    // Extract content for searchability (but keep full envelope in metadata)
    // The message recorder is responsible for filtering - we trust it only sends what should be stored
    const messageData = messageEnvelope.data || messageEnvelope;
    let content: string;

    // Handle transcript types (both 'transcript' and 'transcript_chunk' for compatibility)
    if (messageType === 'transcript_chunk' || messageType === 'transcript') {
      content = typeof messageData === 'string' ? messageData : (messageData.text || '');
    } else if (messageType === 'agent_text') {
      // Agent responses - extract text content
      content = typeof messageData === 'string' ? messageData : (messageData.text || '');
    } else if (messageType === 'user_text') {
      // User text input - data is the text string itself
      content = typeof messageData === 'string' ? messageData : (messageData.text || JSON.stringify(messageData));
    } else if (messageType === 'debug') {
      // Debug messages - extract the message content
      content = typeof messageData === 'string' ? messageData : (messageData.content || messageData.message || JSON.stringify(messageData));
    } else {
      // For other messages, store the data as JSON string for completeness
      content = typeof messageData === 'string' ? messageData : JSON.stringify(messageData);
    }

    // Store the complete envelope in metadata for perfect replay
    // Extract nested speaker info for transcript messages
    const nestedData = messageEnvelope.data || {};
    const nestedSpeakerName = typeof nestedData === 'object' ? nestedData.speaker_name : undefined;
    const nestedSpeakerId = typeof nestedData === 'object' ? nestedData.speaker_id : undefined;

    const completeMetadata = {
      envelope: messageEnvelope,  // Complete original envelope
      participant_identity: participantIdentity,
      participant_name: participantName,
      // Store logical sender from envelope for accurate message attribution
      // Priority: top-level participant_id > nested speaker_name > participantName > participantIdentity
      display_name: messageEnvelope.participant_id || nestedSpeakerName || participantName || participantIdentity,
      // Also store speaker info directly for easier access
      speaker_name: nestedSpeakerName || participantName,
      speaker_id: nestedSpeakerId || participantIdentity,
    };

    // Use the envelope's original timestamp for accurate chronological ordering.
    // Only trust ISO string timestamps (not numeric Unix epochs which could be seconds vs ms).
    // Falls back to now() if not present (matches @default(now()) behavior).
    const envelopeTimestamp = typeof messageEnvelope.timestamp === 'string'
      ? messageEnvelope.timestamp
      : (typeof nestedData === 'object' && typeof nestedData.timestamp === 'string'
        ? nestedData.timestamp
        : undefined);
    const messageTimestamp = envelopeTimestamp ? new Date(envelopeTimestamp) : new Date();
    const validTimestamp = isNaN(messageTimestamp.getTime()) ? new Date() : messageTimestamp;

    const message = await this.prisma.message.create({
      data: {
        sessionId,
        content,
        role,
        status: 'final',
        messageType,
        metadata: completeMetadata,
        timestamp: validTimestamp,
      },
    });

    return { success: true, messageId: message.id, messageType };
  }

  // ============================================================================
  // SSE Session Events
  // ============================================================================

  /**
   * Get an Observable stream of session events for SSE.
   * Events include agent.ready, agent.failed, agent.stopped, etc.
   */
  getSessionEventStream(sessionId: string): Observable<MessageEvent> {
    // Get or create a subject for this session
    // Using ReplaySubject to buffer last 10 events for late subscribers
    let subject = this.sessionEventSubjects.get(sessionId);
    if (!subject) {
      subject = new ReplaySubject<SessionEvent>(10, 30000); // Buffer 10 events, 30 second window
      this.sessionEventSubjects.set(sessionId, subject);
      this.subscriberCounts.set(sessionId, 0);
    }

    // Increment subscriber count
    const currentCount = this.subscriberCounts.get(sessionId) || 0;
    this.subscriberCounts.set(sessionId, currentCount + 1);
    this.logger.log(`SSE subscriber added for session ${sessionId} (total: ${currentCount + 1})`);

    // Return observable that maps SessionEvent to MessageEvent format
    return subject.asObservable().pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({
        data: JSON.stringify(event),
        type: event.type,
        id: `${Date.now()}`,
      })),
      finalize(() => {
        // Decrement subscriber count on unsubscribe
        const count = this.subscriberCounts.get(sessionId) || 1;
        this.subscriberCounts.set(sessionId, count - 1);
        this.logger.log(`SSE subscriber removed for session ${sessionId} (remaining: ${count - 1})`);

        // Clean up subject if no more subscribers
        if (count - 1 <= 0) {
          this.sessionEventSubjects.delete(sessionId);
          this.subscriberCounts.delete(sessionId);
          this.logger.log(`SSE subject cleaned up for session ${sessionId}`);
        }
      }),
    );
  }

  /**
   * Emit a session event to all connected SSE clients.
   * Called by AgentServerService when agent state changes.
   * Creates a ReplaySubject if none exists, so events are buffered for late subscribers.
   */
  emitSessionEvent(event: SessionEvent): void {
    let subject = this.sessionEventSubjects.get(event.sessionId);

    // Create ReplaySubject if it doesn't exist - this allows events to be buffered
    // before any SSE subscribers connect (important for public project join flow)
    if (!subject) {
      subject = new ReplaySubject<SessionEvent>(10, 30000); // Buffer 10 events, 30 second window
      this.sessionEventSubjects.set(event.sessionId, subject);
      this.subscriberCounts.set(event.sessionId, 0);
      this.logger.log(`Created ReplaySubject for session ${event.sessionId} (no subscribers yet)`);
    }

    this.logger.log(`Emitting ${event.type} event for session ${event.sessionId}`);
    subject.next(event);
  }

  /**
   * Emit an agent.ready event.
   */
  emitAgentReady(sessionId: string, agentId: string, agentName: string, agentType?: string): void {
    this.emitSessionEvent({
      type: 'agent.ready',
      sessionId,
      agentId,
      agentName,
      agentType,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit an agent.failed event.
   */
  emitAgentFailed(sessionId: string, agentId: string, agentName: string, error: string): void {
    this.emitSessionEvent({
      type: 'agent.failed',
      sessionId,
      agentId,
      agentName,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit an agent.starting event.
   */
  emitAgentStarting(sessionId: string, agentId: string, agentName: string, agentType?: string): void {
    this.emitSessionEvent({
      type: 'agent.starting',
      sessionId,
      agentId,
      agentName,
      agentType,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit an agent.stopped event.
   */
  emitAgentStopped(sessionId: string, agentId: string, agentName: string): void {
    this.emitSessionEvent({
      type: 'agent.stopped',
      sessionId,
      agentId,
      agentName,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================================
  // Project-level Session Events (for SessionsDashboard real-time updates)
  // ============================================================================

  /**
   * Get an Observable stream of project events for SSE.
   * Events include session.created, session.closed, session.deleted
   */
  getProjectEventStream(projectId: string): Observable<MessageEvent> {
    let subject = this.projectEventSubjects.get(projectId);
    if (!subject) {
      subject = new ReplaySubject<SessionEvent>(10, 30000); // Buffer 10 events, 30 second window
      this.projectEventSubjects.set(projectId, subject);
      this.projectSubscriberCounts.set(projectId, 0);
    }

    const currentCount = this.projectSubscriberCounts.get(projectId) || 0;
    this.projectSubscriberCounts.set(projectId, currentCount + 1);
    this.logger.log(`SSE subscriber added for project ${projectId} (total: ${currentCount + 1})`);

    return subject.asObservable().pipe(
      filter((event) => event.projectId === projectId),
      map((event) => ({
        data: JSON.stringify(event),
        // NOTE: Don't set 'type' field - it maps to SSE 'event:' field which requires
        // addEventListener() on the frontend instead of onmessage. The event type is
        // already in the data JSON.
        id: `${Date.now()}`,
      })),
      finalize(() => {
        const count = this.projectSubscriberCounts.get(projectId) || 1;
        this.projectSubscriberCounts.set(projectId, count - 1);
        this.logger.log(`SSE subscriber removed for project ${projectId} (remaining: ${count - 1})`);

        if (count - 1 <= 0) {
          this.projectEventSubjects.delete(projectId);
          this.projectSubscriberCounts.delete(projectId);
          this.logger.log(`SSE subject cleaned up for project ${projectId}`);
        }
      }),
    );
  }

  /**
   * Emit a project event to all connected SSE clients.
   */
  private emitProjectEvent(event: SessionEvent): void {
    if (!event.projectId) {
      this.logger.warn('Cannot emit project event without projectId');
      return;
    }

    let subject = this.projectEventSubjects.get(event.projectId);
    if (!subject) {
      subject = new ReplaySubject<SessionEvent>(10, 30000);
      this.projectEventSubjects.set(event.projectId, subject);
      this.projectSubscriberCounts.set(event.projectId, 0);
      this.logger.log(`Created ReplaySubject for project ${event.projectId} (no subscribers yet)`);
    }

    this.logger.log(`Emitting ${event.type} event for project ${event.projectId}`);
    subject.next(event);
  }

  /**
   * Emit a session.created event.
   */
  emitSessionCreated(session: { id: string; projectId: string; name?: string | null; room?: { livekitRoomName: string } }): void {
    this.emitProjectEvent({
      type: 'session.created',
      sessionId: session.id,
      projectId: session.projectId,
      sessionName: session.name || session.room?.livekitRoomName || undefined,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a session.closed event.
   */
  emitSessionClosed(sessionId: string, projectId: string, sessionName?: string | null): void {
    this.emitProjectEvent({
      type: 'session.closed',
      sessionId,
      projectId,
      sessionName: sessionName || undefined,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit a session.deleted event.
   */
  emitSessionDeleted(sessionId: string, projectId: string, sessionName?: string | null): void {
    this.emitProjectEvent({
      type: 'session.deleted',
      sessionId,
      projectId,
      sessionName: sessionName || undefined,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================================
  // Participant Presence Events
  // ============================================================================

  /**
   * Handle SSE events from webhook controller.
   * Converts EventEmitter events to SSE stream events.
   */
  @OnEvent('sse.event')
  handleSseEvent(payload: { sessionId: string; event: string; data: any }): void {
    const { sessionId, event, data } = payload;

    // Map webhook events to SessionEvent format
    if (event === 'participant.joined' || event === 'participant.left') {
      this.emitParticipantPresence(
        sessionId,
        data.identity,
        data.name,
        event === 'participant.joined',
      );
    }
  }

  /**
   * Emit a participant presence event.
   */
  emitParticipantPresence(
    sessionId: string,
    participantIdentity: string,
    participantName?: string,
    isOnline: boolean = true,
  ): void {
    // We need to find the session by room name since webhooks use room names
    this.findSessionByRoomName(sessionId).then((session) => {
      if (session) {
        this.emitSessionEvent({
          type: isOnline ? 'participant.joined' : 'participant.left',
          sessionId: session.id,
          participantIdentity,
          participantName,
          isOnline,
          timestamp: new Date().toISOString(),
        });
      }
    }).catch((err) => {
      this.logger.warn(`Failed to find session for presence event: ${err.message}`);
    });
  }

  /**
   * Find a session by LiveKit room name.
   */
  private async findSessionByRoomName(roomName: string) {
    const room = await this.prisma.room.findUnique({
      where: { livekitRoomName: roomName },
      include: { session: true },
    });
    return room?.session || null;
  }

  // ============================================================================
  // Chat History API (for Agent SDK)
  // ============================================================================

  /**
   * Validate an agent's JWT token and verify access to a session.
   *
   * @param token JWT token signed with LIVEKIT_API_SECRET
   * @param sessionId Session ID the agent is requesting access to
   * @returns The decoded token claims if valid
   * @throws UnauthorizedException if token is invalid
   * @throws ForbiddenException if token doesn't have access to the session
   */
  async validateAgentToken(token: string, sessionId: string): Promise<{ identity: string; room: string }> {
    const apiKey = this.livekit.getApiKey();
    const apiSecret = this.livekit.getApiSecret();

    const verifier = new TokenVerifier(apiKey, apiSecret);

    try {
      // Verify the token signature and expiration
      const claims = await verifier.verify(token);

      // Get the identity from claims
      const identity = claims.sub;
      if (!identity) {
        throw new UnauthorizedException('Token missing identity (sub) claim');
      }

      // Verify it's an agent token (identity should start with 'agent-')
      if (!identity.startsWith('agent-')) {
        throw new ForbiddenException('Only agent tokens can access chat history');
      }

      // Get the room from video grants
      const roomName = claims.video?.room;
      if (!roomName) {
        throw new UnauthorizedException('Token missing room claim');
      }

      // Verify the session exists and get its room name
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { room: true },
      });

      if (!session) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      // Verify the token's room matches the session's room
      if (session.room?.livekitRoomName !== roomName) {
        throw new ForbiddenException('Token does not have access to this session');
      }

      return { identity, room: roomName };
    } catch (error) {
      if (error instanceof UnauthorizedException ||
          error instanceof ForbiddenException ||
          error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Token validation failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // ============================================================================
  // Transcript Export
  // ============================================================================

  /**
   * Return the distinct messageType values actually stored for a session,
   * with counts. Used by the download picker to only show types that
   * exist in this session's data.
   */
  async getTranscriptMessageTypes(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const grouped = await this.prisma.message.groupBy({
      by: ['messageType'],
      where: { sessionId },
      _count: { _all: true },
    });

    return {
      sessionId,
      types: grouped
        .map((g) => ({ messageType: g.messageType, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Return the distinct messageType values actually stored for a session,
   * with counts. Used by the transcript download picker so it only shows
   * types that exist in this session's data.
   */
  async getTranscriptMessageTypes(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const grouped = await this.prisma.message.groupBy({
      by: ['messageType'],
      where: { sessionId },
      _count: { _all: true },
    });

    return {
      sessionId,
      types: grouped
        .map((g) => ({ messageType: g.messageType, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Export a complete transcript of a session.
   * Returns all messages, participants, and agents for the session.
   *
   * @param sessionId Session ID to export
   * @param options Export options
   * @returns Complete transcript data
   */
  async exportTranscript(
    sessionId: string,
    options: {
      includeDebug?: boolean;
      includeMetadata?: boolean;
      includeDeliverables?: boolean;
      mode?: 'transcript' | 'verdicts' | 'full' | 'custom';
      types?: string[];
    } = {},
  ) {
    const includeDeliverables = options.includeDeliverables !== false;
    // Resolution order: explicit `types` → `mode` → legacy `includeDebug` → default `transcript`.
    const mode: 'transcript' | 'verdicts' | 'full' | 'custom' =
      options.types && options.types.length > 0
        ? 'custom'
        : options.mode ?? (options.includeDebug ? 'full' : 'transcript');

    // Fetch session with project info
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        room: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    // Define message types to include
    const chatMessageTypes = [
      'user_text', 'transcript', 'transcript_chunk', 'agent_text',
      'participant_joined', 'participant_left', 'participant_event'
    ];
    const debugMessageTypes = [
      'debug', 'decision_stream', 'expert_status', 'prompt_execution',
      'safety_check', 'plan_progress_update', 'plan_deliverable_update',
      'state_change_notification', 'complete_todo_list', 'llm_config',
      'task_progress_update', 'progress_update', 'task_update'
    ];
    // Sub-agent verdict types — surfaced by `mode=verdicts` alongside the chat.
    const verdictMessageTypes = ['expert_status', 'safety_check'];

    const messageTypes =
      mode === 'custom'
        ? (options.types ?? [])
        : mode === 'full'
          ? [...chatMessageTypes, ...debugMessageTypes]
          : mode === 'verdicts'
            ? [...chatMessageTypes, ...verdictMessageTypes]
            : chatMessageTypes;

    // Deliverable data comes from SessionState.deliverables (populated by gRPC setDeliverable calls),
    // NOT from Message rows — the set_deliverable tool only calls gRPC, not LiveKit data messages.
    const [messages, participants, agents, sessionState] = await Promise.all([
      this.prisma.message.findMany({
        where: { sessionId, messageType: { in: messageTypes } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.participant.findMany({
        where: { sessionId },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.agentInstance.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      }),
      includeDeliverables
        ? this.prisma.sessionState.findUnique({
            where: { sessionId },
            select: { deliverables: true, planData: true },
          })
        : Promise.resolve(null),
    ]);

    // Build deliverables data from SessionState (the source of truth)
    let deliverablesSummary: Record<string, TranscriptDeliverableSummaryEntry> | undefined;
    const messageDeliverables = new Map<string, TranscriptMessageDeliverable[]>();

    const collected = this.parseJsonRecord<DeliverableValue>(sessionState?.deliverables);

    if (includeDeliverables && collected) {
      const planData = sessionState!.planData as PlanData | null;

      // Build description lookup: planData.states[].tasks[].deliverables[]
      const planLookup = new Map<string, { description: string; required?: boolean }>();
      for (const state of planData?.states ?? []) {
        for (const task of state.tasks) {
          for (const del of task.deliverables ?? []) {
            planLookup.set(del.key, { description: del.description, required: del.required });
          }
        }
      }

      // Build top-level summary
      deliverablesSummary = {};
      for (const [key, del] of Object.entries(collected)) {
        const plan = planLookup.get(key);
        deliverablesSummary[key] = {
          value: del.value,
          reasoning: del.reasoning,
          collectedAt: del.collectedAt,
          description: plan?.description,
          required: plan?.required,
        };
      }

      // Attach deliverables to user messages using collectedAt timestamps
      const userMessages = messages.filter(
        (m) => m.role === 'user' && (m.messageType === 'transcript' || m.messageType === 'transcript_chunk' || m.messageType === 'user_text'),
      );
      for (const [key, del] of Object.entries(collected)) {
        if (!del.collectedAt || userMessages.length === 0) continue;
        const collectedAt = new Date(del.collectedAt);

        // Walk backwards to find nearest preceding user message
        let targetId = userMessages[0].id;
        for (let i = userMessages.length - 1; i >= 0; i--) {
          if (userMessages[i].timestamp <= collectedAt) {
            targetId = userMessages[i].id;
            break;
          }
        }

        const list = messageDeliverables.get(targetId) ?? [];
        list.push({ key, value: del.value, reasoning: del.reasoning });
        messageDeliverables.set(targetId, list);
      }
    }

    const deliverableCount = deliverablesSummary ? Object.keys(deliverablesSummary).length : 0;

    return {
      meta: {
        sessionId: session.id,
        sessionName: session.name,
        projectId: session.projectId,
        projectName: session.project.name,
        exportedAt: new Date().toISOString(),
        mode,
        selectedTypes: mode === 'custom' ? messageTypes : undefined,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        closedAt: session.closedAt?.toISOString() || null,
        messageCount: messages.length,
        participantCount: participants.length,
        ...(includeDeliverables ? { deliverableCount } : {}),
      },
      participants: participants.map((p) => ({
        id: p.id,
        name: p.name,
        identity: p.identity,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt?.toISOString() || null,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        agentType: a.agentTypeId || null,
        status: a.status,
      })),
      ...(deliverablesSummary ? { deliverables: deliverablesSummary } : {}),
      messages: messages.map((m) => {
        const metadata = m.metadata as Record<string, any> | null;
        const collected = messageDeliverables.get(m.id);
        return {
          id: m.id,
          timestamp: m.timestamp.toISOString(),
          role: m.role || 'system',
          messageType: m.messageType,
          content: m.content,
          speakerName: metadata?.speaker_name || metadata?.participant_name || null,
          speakerId: metadata?.speaker_id || metadata?.participant_identity || null,
          ...(options.includeMetadata && metadata ? { metadata } : {}),
          ...(collected ? { collectedDeliverables: collected } : {}),
        };
      }),
    };
  }

  /**
   * Safely parse a Prisma JSON field as a Record<string, T>.
   * Returns null if the value is not a non-empty object.
   */
  private parseJsonRecord<T>(json: Prisma.JsonValue | undefined | null): Record<string, T> | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    if (Object.keys(json).length === 0) return null;
    return json as Record<string, T>;
  }

  /**
   * Get chat history for a session.
   *
   * This endpoint is designed for agents to fetch conversation history
   * for building context or resuming conversations.
   *
   * @param sessionId Session ID to get history for
   * @param options Query options
   * @returns Paginated list of messages with full envelope data
   */
  async getChatHistory(
    sessionId: string,
    options: {
      includeDebug?: boolean;
      limit?: number;
      before?: string;
    } = {},
  ) {
    const limit = Math.min(options.limit || 100, 500);

    // Define message types to include
    const chatMessageTypes = ['user_text', 'transcript', 'transcript_chunk', 'agent_text'];
    const debugMessageTypes = ['debug', 'decision_stream', 'expert_status', 'prompt_execution', 'safety_check'];

    const messageTypes = options.includeDebug
      ? [...chatMessageTypes, ...debugMessageTypes]
      : chatMessageTypes;

    // Build where clause
    const where: Prisma.MessageWhereInput = {
      sessionId,
      messageType: { in: messageTypes },
      ...(options.before && { timestamp: { lt: new Date(options.before) } }),
    };

    // Fetch messages with pagination (one extra to check hasMore)
    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const results = hasMore ? messages.slice(0, -1) : messages;

    // Transform to response format with full envelope
    const formattedMessages = results.reverse().map((msg) => ({
      id: msg.id,
      timestamp: msg.timestamp.toISOString(),
      envelope: (msg.metadata as any)?.envelope || {
        type: msg.messageType,
        data: msg.content,
      },
      role: msg.role || 'system',
      content: msg.content,
      messageType: msg.messageType,
    }));

    return {
      messages: formattedMessages,
      hasMore,
      nextCursor: hasMore && results.length > 0
        ? results[results.length - 1].timestamp.toISOString()
        : null,
    };
  }
}
