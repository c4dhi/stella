import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { SessionsService } from '../sessions/sessions.service';
import { LiveKitService } from '../livekit/livekit.service';

interface ParticipantJoinedEvent {
  roomName: string;
  participantIdentity: string;
  participantSid: string;
  participantName?: string;
  metadata?: string;
  joinedAt?: number;
}

interface ParticipantLeftEvent {
  roomName: string;
  participantIdentity: string;
  participantSid: string;
}

// Grace period before recorder leaves an empty room (5 minutes)
const RECORDER_LEAVE_GRACE_PERIOD_MS = 5 * 60 * 1000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  // Timers for delayed recorder leave (keyed by sessionId)
  private recorderLeaveTimers: Map<string, NodeJS.Timeout> = new Map();

  // Timers for delayed agent pause (keyed by sessionId)
  private agentPauseTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private livekitService: LiveKitService,
    @Inject(forwardRef(() => AgentsService))
    private agentsService: AgentsService,
    @Inject(forwardRef(() => SessionsService))
    private sessionsService: SessionsService,
  ) {}

  /**
   * Check if a participant identity is a human (not an agent or system participant)
   */
  private isHumanParticipant(identity: string): boolean {
    // Exclude agent identities (start with 'agent-')
    if (identity.startsWith('agent-')) return false;
    // Exclude message recorder
    if (identity === 'message-recorder') return false;
    // Exclude system identities
    if (identity.startsWith('system-')) return false;
    // Everything else is considered human
    return true;
  }

  /**
   * Check if a participant identity is an agent
   */
  private isAgentParticipant(identity: string): boolean {
    return identity.startsWith('agent-');
  }

  /**
   * Handle any participant joining a room.
   * Updates recorder join state and triggers agent spawning for on_demand sessions.
   */
  async handleParticipantActivity(
    sessionId: string,
    participantIdentity: string,
    participantName?: string,
  ): Promise<void> {
    const isHuman = this.isHumanParticipant(participantIdentity);
    const isAgent = this.isAgentParticipant(participantIdentity);

    this.logger.log(
      `Participant activity: ${participantIdentity} joined session ${sessionId} (isHuman: ${isHuman}, isAgent: ${isAgent})`,
    );

    // Cancel any pending leave timer for this session
    this.cancelRecorderLeaveTimer(sessionId);

    // Cancel any pending agent pause timer for this session
    this.cancelAgentPauseTimer(sessionId);

    // Get current session state
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        agents: {
          where: { status: { in: ['RUNNING', 'STARTING'] } },
        },
      },
    });

    if (!session) {
      this.logger.warn(`Session ${sessionId} not found for participant activity`);
      return;
    }

    // Always ensure recorder should join when any meaningful participant is present
    if (!session.recorderShouldJoin) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { recorderShouldJoin: true },
      });

      // Emit event for recorder to potentially join
      this.eventEmitter.emit('recorder.room-join-needed', {
        sessionId,
        roomName: session.id, // Room name lookup would be needed
      });

      this.logger.log(`Set recorderShouldJoin=true for session ${sessionId}`);
    }

    // Handle human participant
    if (isHuman) {
      // Update human presence tracking
      if (!session.hasHumanParticipant) {
        await this.prisma.session.update({
          where: { id: sessionId },
          data: {
            hasHumanParticipant: true,
            humanJoinedAt: new Date(),
            humanLeftAt: null,
          },
        });

        this.logger.log(`Human joined session ${sessionId}: ${participantIdentity}`);
      }

      // Auto-resume agent for any session with saved config (not just on_demand)
      // This handles both on_demand spawn and auto-restart after inactivity pause
      const hasRunningAgent = session.agents.length > 0;
      if (!hasRunningAgent && session.lastAgentConfig) {
        this.logger.log(`Auto-resume triggered for session ${sessionId} (human joined)`);
        await this.spawnOrResumeAgent(session);
      }
    }
  }

  /**
   * Handle participant leaving a room.
   * Manages recorder leave and agent pause timers.
   */
  async handleParticipantInactivity(
    sessionId: string,
    participantIdentity: string,
  ): Promise<void> {
    const isHuman = this.isHumanParticipant(participantIdentity);

    this.logger.log(
      `Participant left: ${participantIdentity} from session ${sessionId} (isHuman: ${isHuman})`,
    );

    // Get current session with participant counts
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        room: true,
      },
    });

    if (!session || !session.room) {
      this.logger.warn(`Session ${sessionId} not found for participant inactivity`);
      return;
    }

    // Count remaining participants in the room (exclude message-recorder)
    // We need to check LiveKit room state, but since we're using webhooks,
    // we can track via the webhook events themselves
    const remainingParticipants = await this.countRoomParticipants(session.room.livekitRoomName);

    this.logger.log(`Session ${sessionId} has ${remainingParticipants.humans} humans and ${remainingParticipants.agents} agents remaining`);

    // Handle human leaving
    if (isHuman) {
      // Check if there are any other humans
      if (remainingParticipants.humans === 0) {
        // Update human presence tracking
        await this.prisma.session.update({
          where: { id: sessionId },
          data: {
            hasHumanParticipant: false,
            humanLeftAt: new Date(),
          },
        });

        this.logger.log(`All humans left session ${sessionId}`);

        // Start agent pause timer if session has inactivity timeout configured
        if (session.agentInactivityTimeoutMinutes !== null) {
          this.startAgentPauseTimer(sessionId, session.agentInactivityTimeoutMinutes);
        }
      }
    }

    // If NO participants remain (no humans AND no agents), start recorder leave timer
    if (remainingParticipants.humans === 0 && remainingParticipants.agents === 0) {
      this.startRecorderLeaveTimer(sessionId);
    }
  }

  /**
   * Count participants in a room by type.
   * Queries LiveKit directly (source of truth) instead of relying on DB records,
   * which may have mismatched identities.
   */
  private async countRoomParticipants(roomName: string): Promise<{ humans: number; agents: number }> {
    const participants = await this.livekitService.listRoomParticipants(roomName);

    let humans = 0;
    let agents = 0;
    for (const p of participants) {
      if (this.isHumanParticipant(p.identity)) {
        humans++;
      } else if (this.isAgentParticipant(p.identity)) {
        agents++;
      }
    }

    return { humans, agents };
  }

  /**
   * Start a timer to set recorderShouldJoin=false after grace period.
   */
  private startRecorderLeaveTimer(sessionId: string): void {
    // Cancel any existing timer
    this.cancelRecorderLeaveTimer(sessionId);

    this.logger.log(
      `Starting recorder leave timer for session ${sessionId} (${RECORDER_LEAVE_GRACE_PERIOD_MS / 1000}s)`,
    );

    const timer = setTimeout(async () => {
      this.recorderLeaveTimers.delete(sessionId);

      // Double-check room is still empty before leaving
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { room: true },
      });

      if (!session || !session.room) return;

      const remaining = await this.countRoomParticipants(session.room.livekitRoomName);
      if (remaining.humans === 0 && remaining.agents === 0) {
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { recorderShouldJoin: false },
        });

        this.eventEmitter.emit('recorder.room-leave-needed', { sessionId });
        this.logger.log(`Recorder leave triggered for session ${sessionId} (room empty)`);
      } else {
        this.logger.log(`Recorder leave cancelled for session ${sessionId} (participants returned)`);
      }
    }, RECORDER_LEAVE_GRACE_PERIOD_MS);

    this.recorderLeaveTimers.set(sessionId, timer);
  }

  /**
   * Cancel a pending recorder leave timer.
   */
  private cancelRecorderLeaveTimer(sessionId: string): void {
    const timer = this.recorderLeaveTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.recorderLeaveTimers.delete(sessionId);
      this.logger.log(`Cancelled recorder leave timer for session ${sessionId}`);
    }
  }

  /**
   * Start a timer to pause agents after the configured timeout.
   * @param sessionId - The session ID
   * @param timeoutMinutes - Timeout in minutes before pausing agents
   */
  private startAgentPauseTimer(sessionId: string, timeoutMinutes: number): void {
    // Cancel any existing timer
    this.cancelAgentPauseTimer(sessionId);

    const timeoutMs = timeoutMinutes * 60 * 1000;

    this.logger.log(
      `Starting agent pause timer for session ${sessionId} (${timeoutMinutes} minutes)`,
    );

    const timer = setTimeout(async () => {
      this.agentPauseTimers.delete(sessionId);

      // Double-check no humans have returned
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          agents: { where: { status: { in: ['RUNNING', 'STARTING'] } } },
        },
      });

      if (!session || session.hasHumanParticipant) {
        this.logger.log(`Agent pause cancelled for session ${sessionId} (human returned)`);
        return;
      }

      // Pause agents if there are any running (for any session type with timeout configured)
      if (session.agents.length > 0) {
        await this.pauseAgents(sessionId);
      }
    }, timeoutMs);

    this.agentPauseTimers.set(sessionId, timer);
  }

  /**
   * Cancel a pending agent pause timer.
   */
  private cancelAgentPauseTimer(sessionId: string): void {
    const timer = this.agentPauseTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.agentPauseTimers.delete(sessionId);
      this.logger.log(`Cancelled agent pause timer for session ${sessionId}`);
    }
  }

  /**
   * Pause all agents in a session due to inactivity.
   * Saves agent config for later resume and stops K8s pods.
   */
  private async pauseAgents(sessionId: string): Promise<void> {
    this.logger.log(`Pausing agents for session ${sessionId} due to inactivity`);

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        agents: { where: { status: { in: ['RUNNING', 'STARTING'] } } },
      },
    });

    if (!session) return;

    // Save the first agent's config for respawning later
    const firstAgent = session.agents[0];
    if (firstAgent) {
      const agentConfig = {
        name: firstAgent.name,
        icon: firstAgent.icon,
        agentType: firstAgent.agentType,
        agentConfig: firstAgent.agentConfig,
        envVarTemplateId: firstAgent.envVarTemplateId,
      };

      await this.prisma.session.update({
        where: { id: sessionId },
        data: { lastAgentConfig: agentConfig },
      });
    }

    // Pause each agent
    for (const agent of session.agents) {
      try {
        // Update agent record
        await this.prisma.agentInstance.update({
          where: { id: agent.id },
          data: {
            pausedAt: new Date(),
            pauseReason: 'inactivity',
          },
        });

        // Stop the K8s pod
        await this.agentsService.stopAgent(agent.id);

        this.logger.log(`Paused agent ${agent.id} for session ${sessionId}`);
      } catch (error) {
        this.logger.error(`Failed to pause agent ${agent.id}: ${error.message}`);
      }
    }
  }

  /**
   * Spawn or resume an agent for an on_demand session.
   * Uses saved config from session.lastAgentConfig.
   */
  private async spawnOrResumeAgent(session: any): Promise<void> {
    if (!session.lastAgentConfig) {
      this.logger.warn(`No lastAgentConfig for session ${session.id}, cannot spawn agent`);
      return;
    }

    const config = session.lastAgentConfig as any;

    this.logger.log(`Spawning agent for on_demand session ${session.id}`);

    try {
      // Get project owner for env var template access
      const projectMembership = await this.prisma.projectMembership.findFirst({
        where: {
          projectId: session.projectId,
          role: { in: ['OWNER', 'ADMIN'] },
        },
      });

      if (!projectMembership) {
        this.logger.error(`No owner found for project ${session.projectId}`);
        return;
      }

      // Find any paused agent to increment resume count
      const pausedAgent = await this.prisma.agentInstance.findFirst({
        where: {
          sessionId: session.id,
          pausedAt: { not: null },
        },
        orderBy: { pausedAt: 'desc' },
      });

      // Create new agent instance
      const agent = await this.agentsService.create(
        session.id,
        {
          name: config.name || 'Agent',
          icon: config.icon || '🤖',
          agentType: config.agentType || 'stella-agent',
          config: config.agentConfig || {},
          envVarTemplateId: config.envVarTemplateId,
        },
        projectMembership.userId,
      );

      // If resuming from paused state, increment resume count
      if (pausedAgent) {
        await this.prisma.agentInstance.update({
          where: { id: agent.id },
          data: { resumeCount: pausedAgent.resumeCount + 1 },
        });
      }

      this.logger.log(`Spawned agent ${agent.id} for on_demand session ${session.id}`);
    } catch (error) {
      this.logger.error(`Failed to spawn agent for session ${session.id}: ${error.message}`);
    }
  }

  // ============================================================================
  // Event Handlers (called by livekit-webhook.controller.ts)
  // ============================================================================

  /**
   * Handle participant joined event from LiveKit webhook
   * Updates participant presence status in database
   */
  @OnEvent('livekit.participant.joined')
  async handleParticipantJoined(event: ParticipantJoinedEvent): Promise<void> {
    const { roomName, participantIdentity, participantName } = event;

    this.logger.log(
      `Updating presence for joined participant: ${participantIdentity} in room ${roomName}`,
    );

    try {
      // Find the session by room name
      const room = await this.prisma.room.findUnique({
        where: { livekitRoomName: roomName },
        select: { sessionId: true },
      });

      if (!room) {
        this.logger.warn(`Room not found for LiveKit room: ${roomName}`);
        return;
      }

      // Update participant's lastSeenAt to mark them as online
      const result = await this.prisma.participant.updateMany({
        where: {
          sessionId: room.sessionId,
          identity: participantIdentity,
        },
        data: {
          lastSeenAt: new Date(),
          leftAt: null, // Clear leftAt to mark as online
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Updated presence for participant ${participantIdentity} - marked as online`,
        );
      } else {
        this.logger.debug(
          `No participant found with identity ${participantIdentity} in session ${room.sessionId}`,
        );
      }

      // Handle participant activity for recorder/agent management
      await this.handleParticipantActivity(room.sessionId, participantIdentity, participantName);

    } catch (error) {
      this.logger.error(
        `Failed to update participant presence on join: ${error.message}`,
      );
    }
  }

  /**
   * Handle participant left event from LiveKit webhook
   * Updates participant presence status in database
   */
  @OnEvent('livekit.participant.left')
  async handleParticipantLeft(event: ParticipantLeftEvent): Promise<void> {
    const { roomName, participantIdentity } = event;

    this.logger.log(
      `Updating presence for left participant: ${participantIdentity} from room ${roomName}`,
    );

    try {
      // Find the session by room name
      const room = await this.prisma.room.findUnique({
        where: { livekitRoomName: roomName },
        select: { sessionId: true },
      });

      if (!room) {
        this.logger.warn(`Room not found for LiveKit room: ${roomName}`);
        return;
      }

      // Update participant's lastSeenAt and leftAt to mark them as offline
      const result = await this.prisma.participant.updateMany({
        where: {
          sessionId: room.sessionId,
          identity: participantIdentity,
        },
        data: {
          lastSeenAt: new Date(),
          leftAt: new Date(), // Set leftAt to mark as offline
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Updated presence for participant ${participantIdentity} - marked as offline`,
        );
      }

      // Handle participant inactivity for recorder/agent management
      await this.handleParticipantInactivity(room.sessionId, participantIdentity);

    } catch (error) {
      this.logger.error(
        `Failed to update participant presence on leave: ${error.message}`,
      );
    }
  }
}
