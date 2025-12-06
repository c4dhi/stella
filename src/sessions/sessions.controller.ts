import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Sse,
  ValidationPipe,
  UsePipes,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Request,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import type { LogEntry } from '../message-recorder/room-monitor.service';

interface MessageEvent {
  data: string;
  id?: string;
  type?: string;
  retry?: number;
}

@Controller()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class SessionsController {
  private readonly logger = new Logger(SessionsController.name);

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('projects/:projectId/sessions')
  create(
    @Param('projectId') projectId: string,
    @Body() createSessionDto: CreateSessionDto,
  ) {
    return this.sessionsService.create(projectId, createSessionDto);
  }

  @Get('projects/:projectId/sessions')
  findAll(
    @Param('projectId') projectId: string,
    @Query() query: QuerySessionsDto,
  ) {
    return this.sessionsService.findAll(projectId, query);
  }

  @Get('sessions/:sessionId')
  findOne(@Param('sessionId') id: string) {
    return this.sessionsService.findOne(id);
  }

  @Post('sessions/:sessionId/joinToken')
  createJoinToken(
    @Param('sessionId') sessionId: string,
    @Body() createTokenDto: CreateTokenDto,
  ) {
    return this.sessionsService.createJoinToken(sessionId, createTokenDto);
  }

  @Get('sessions/:sessionId/timeline')
  getTimeline(
    @Param('sessionId') sessionId: string,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
  ) {
    return this.sessionsService.getTimeline(sessionId, skip, take);
  }

  @Patch('sessions/:sessionId')
  update(
    @Param('sessionId') id: string,
    @Body() updateSessionDto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(id, updateSessionDto);
  }

  @Patch('sessions/:sessionId/close')
  close(@Param('sessionId') id: string) {
    return this.sessionsService.close(id);
  }

  @Delete('sessions/:sessionId')
  delete(@Param('sessionId') id: string) {
    return this.sessionsService.delete(id);
  }

  // Participant management endpoints
  @Post('sessions/:sessionId/participants')
  registerParticipant(
    @Param('sessionId') sessionId: string,
    @Body('name') name: string,
  ) {
    return this.sessionsService.registerParticipant(sessionId, name);
  }

  @Get('sessions/:sessionId/participants')
  listParticipants(@Param('sessionId') sessionId: string) {
    return this.sessionsService.listParticipants(sessionId);
  }

  // Dashboard endpoint: Get participant connection info by ID (user-authenticated)
  @Get('participants/:participantId/connection-info')
  getParticipantConnectionInfoById(@Param('participantId') participantId: string) {
    // User-authenticated - dashboard uses this to generate QR codes
    return this.sessionsService.getParticipantConnectionInfoWithToken(participantId);
  }

  // Mobile app endpoint: Get own connection info (participant-authenticated)
  // This endpoint also serves as token refresh - returns a fresh LiveKit token (24h TTL)
  @Get('participants/connection-info')
  getParticipantConnectionInfo(@Request() req) {
    // Extract participantId from participant JWT token
    const participantId = req.user.participantId;
    if (!participantId) {
      throw new BadRequestException('Invalid participant token');
    }
    return this.sessionsService.getParticipantConnectionInfo(participantId);
  }

  // Explicit token refresh endpoint for mobile apps
  // Returns fresh LiveKit token (24h TTL) for indefinite connection
  @Post('participants/refresh')
  refreshLivekitToken(@Request() req) {
    // Extract participantId from participant JWT token
    const participantId = req.user.participantId;
    if (!participantId) {
      throw new BadRequestException('Invalid participant token');
    }
    return this.sessionsService.getParticipantConnectionInfo(participantId);
  }

  // Heartbeat endpoint for participant presence tracking
  // Called periodically by participant clients to update lastSeenAt
  @Post('participants/heartbeat')
  participantHeartbeat(@Request() req) {
    const participantId = req.user.participantId;
    if (!participantId) {
      throw new BadRequestException('Invalid participant token');
    }
    return this.sessionsService.participantHeartbeat(participantId);
  }

  @Delete('participants/:participantId')
  removeParticipant(@Param('participantId') participantId: string) {
    return this.sessionsService.removeParticipant(participantId);
  }

  // Message retrieval endpoints
  @Get('sessions/:sessionId/messages')
  async getMessages(
    @Param('sessionId') sessionId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string,
    @Query('before') before?: string,
  ) {
    try {
      // Validate and cap limit
      const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;

      if (isNaN(limit) || limit < 1) {
        throw new BadRequestException('Invalid limit parameter');
      }

      // Validate session exists before querying messages
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        throw new NotFoundException(`Session ${sessionId} not found`);
      }

      this.logger.debug(
        `Fetching messages for session ${sessionId} (cursor: ${cursor || 'none'}, limit: ${limit})`,
      );

      return await this.sessionsService.getMessages(sessionId, {
        cursor,
        limit,
        before,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get messages for session ${sessionId}:`,
        error.stack,
      );
      throw error;
    }
  }

  @Get('sessions/:sessionId/messages/latest')
  getLatestMessages(
    @Param('sessionId') sessionId: string,
    @Query('since') since?: string,
  ) {
    if (!since) {
      return { messages: [] };
    }
    return this.sessionsService.getMessagesSince(sessionId, since);
  }

  // Listener monitoring endpoint
  @Get('sessions/:sessionId/listener-status')
  getListenerStatus(@Param('sessionId') sessionId: string) {
    return this.sessionsService.getListenerStatus(sessionId);
  }

  // SSE endpoint for real-time session events (agent ready, agent failed, etc.)
  @Sse('sessions/:sessionId/events')
  streamSessionEvents(@Param('sessionId') sessionId: string): Observable<MessageEvent> {
    this.logger.log(`SSE connection opened for session ${sessionId}`);
    return this.sessionsService.getSessionEventStream(sessionId);
  }

  // Get monitoring logs
  @Get('monitoring/logs')
  getMonitoringLogs(@Query('sessionId') sessionId?: string): Promise<{
    logs: LogEntry[];
    total: number;
    sessionId: string | null;
  }> {
    return this.sessionsService.getMonitoringLogs(sessionId);
  }

  // Get global monitoring status
  @Get('monitoring/status')
  getMonitoringStatus() {
    return this.sessionsService.getMonitoringStatus();
  }

  // ============================================================================
  // Internal API Endpoints (for Python message recorder service)
  // Note: These routes are at /internal/* (excluded from global /api prefix)
  // ============================================================================

  /**
   * Get all active sessions that need monitoring.
   * Used by the Python message recorder to discover rooms to join.
   */
  @Public()
  @Get('internal/active-sessions')
  async getActiveSessions() {
    return this.sessionsService.findActiveSessions();
  }

  /**
   * Store a recorded message from the Python message recorder.
   * This replaces the WebRTC-based recording from the Node.js monitor.
   */
  @Public()
  @Post('internal/sessions/:sessionId/messages')
  async storeRecordedMessage(
    @Param('sessionId') sessionId: string,
    @Body() data: {
      message: any;
      participantIdentity?: string;
      participantName?: string;
    },
  ) {
    return this.sessionsService.storeRecordedMessage(
      sessionId,
      data.message,
      data.participantIdentity,
      data.participantName,
    );
  }

  /**
   * Store log entries from the Python message recorder.
   * Allows Python service to submit logs for display in the dashboard.
   */
  @Public()
  @Post('internal/monitoring/logs')
  async storeMonitoringLog(
    @Body() logData: {
      level: 'log' | 'debug' | 'warn' | 'error';
      message: string;
      sessionId?: string;
      data?: any;
    },
  ) {
    return this.sessionsService.storeMonitoringLog(logData);
  }

  /**
   * Update connection status from Python message recorder.
   * Allows Python service to report which sessions it's actively monitoring.
   */
  @Public()
  @Post('internal/monitoring/status')
  async updateMonitoringStatus(
    @Body() statusData: {
      connectedSessions: string[];
    },
  ) {
    return this.sessionsService.updateMonitoringStatus(statusData);
  }

  /**
   * Store participant join/leave events from Python message recorder.
   * Creates timeline messages for conversation playback.
   */
  @Public()
  @Post('internal/sessions/:sessionId/participant-events')
  async storeParticipantEvent(
    @Param('sessionId') sessionId: string,
    @Body() eventData: {
      eventType: 'joined' | 'left';
      participantIdentity: string;
      participantName?: string;
    },
  ) {
    return this.sessionsService.storeParticipantEvent(sessionId, eventData);
  }

  /**
   * Get chat history for an agent.
   *
   * This endpoint allows agents to fetch conversation history for their session.
   * The agent must provide a valid LiveKit JWT token in the Authorization header.
   *
   * Unlike other /internal/* endpoints, this one validates the agent's token
   * to ensure agents can only access their own session's history.
   *
   * Headers:
   *   - Authorization: Bearer <token> - Agent's LiveKit JWT token (required)
   *
   * Query parameters:
   *   - include_debug: boolean - Include debug/processing messages (default: false)
   *   - limit: number - Max messages to return (default: 100, max: 500)
   *   - before: string - ISO timestamp cursor for pagination
   *
   * Response:
   *   - messages: Array of messages with full envelope data
   *   - hasMore: boolean - Whether more messages exist
   *   - nextCursor: string | null - Cursor for next page
   */
  @Public()
  @Get('internal/sessions/:sessionId/chat-history')
  async getChatHistory(
    @Param('sessionId') sessionId: string,
    @Headers('authorization') authHeader: string,
    @Query('include_debug') includeDebug?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    // Extract token from Authorization header
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header. Expected: Bearer <token>');
    }
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate the agent's token and verify access to this session
    await this.sessionsService.validateAgentToken(token, sessionId);

    // Fetch and return chat history
    return this.sessionsService.getChatHistory(sessionId, {
      includeDebug: includeDebug === 'true',
      limit: limit ? parseInt(limit, 10) : undefined,
      before: before,
    });
  }
}
