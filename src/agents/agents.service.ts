import { Injectable, NotFoundException, BadRequestException, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { AgentServerService } from '../agent-server/agent-server.service';
import { SessionsService } from '../sessions/sessions.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { AgentStatus, Prisma } from '@prisma/client';

/**
 * AgentsService - Manages agent lifecycle.
 *
 * In the new architecture:
 * - Agents connect directly to LiveKit rooms via SDK
 * - Session-management-server only deploys K8s pods
 * - No RoomAgentService needed (agents handle audio directly)
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private prisma: PrismaService,
    private k8s: KubernetesService,
    private configService: ConfigService,
    @Optional() private agentServerService?: AgentServerService,
    @Optional() @Inject(forwardRef(() => SessionsService)) private sessionsService?: SessionsService,
  ) {
    // Validate OpenAI API key on startup
    this.validateOpenAIKey();
  }

  /**
   * Validate OpenAI API key format
   */
  private validateOpenAIKey(): void {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.error('❌ OPENAI_API_KEY is not set in environment variables');
      this.logger.error('   Agents will fail to start. Please set OPENAI_API_KEY in .env file');
      return;
    }

    // Check basic format
    if (!apiKey.startsWith('sk-')) {
      this.logger.error(`❌ OPENAI_API_KEY has invalid format: ${apiKey.substring(0, 7)}...`);
      this.logger.error('   Valid OpenAI keys start with "sk-"');
      return;
    }

    // Check reasonable length (OpenAI keys are typically 48-51 characters)
    if (apiKey.length < 40) {
      this.logger.error(`❌ OPENAI_API_KEY appears truncated (${apiKey.length} chars)`);
      this.logger.error('   Expected length: 48-51 characters');
      return;
    }

    this.logger.log(`✅ OPENAI_API_KEY is set (${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)})`);
    this.logger.log(`   Key length: ${apiKey.length} characters`);
  }

  /**
   * Map Kubernetes pod phase to AgentStatus
   */
  private mapPodPhaseToAgentStatus(podStatus: any): AgentStatus | null {
    if (!podStatus) {
      return AgentStatus.STOPPED;
    }

    const phase = podStatus.phase;
    const containerStatuses = podStatus.containerStatuses;

    // Check if container is running
    if (phase === 'Running') {
      return AgentStatus.RUNNING;
    }

    // Check if pod is pending (starting)
    if (phase === 'Pending') {
      return AgentStatus.STARTING;
    }

    // Check if pod succeeded (graceful stop)
    if (phase === 'Succeeded') {
      return AgentStatus.STOPPED;
    }

    // Check if pod failed
    if (phase === 'Failed') {
      return AgentStatus.FAILED;
    }

    // Check container states for more detail
    if (containerStatuses && containerStatuses.length > 0) {
      const containerState = containerStatuses[0].state;
      if (containerState?.waiting) {
        return AgentStatus.STARTING;
      }
      if (containerState?.terminated) {
        const exitCode = containerState.terminated.exitCode;
        return exitCode === 0 ? AgentStatus.STOPPED : AgentStatus.FAILED;
      }
    }

    return null; // Unknown state, don't update
  }

  /**
   * Sync agent status from Kubernetes pod status.
   * All agents run as K8s pods - no in-process agents.
   */
  async syncAgentStatus(agentId: string): Promise<AgentStatus | null> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      return null;
    }

    // Agent still STARTING with no podName yet - pod creation is async, give it time
    if (agent.status === AgentStatus.STARTING && !agent.podName) {
      // Check how long it's been starting
      const createdAt = agent.createdAt;
      const ageMs = Date.now() - createdAt.getTime();
      const maxWaitMs = 5 * 60 * 1000; // 5 minutes for image build

      if (ageMs < maxWaitMs) {
        // Still within acceptable startup window
        this.logger.debug(`Agent ${agentId} still starting, waiting for pod (${Math.round(ageMs / 1000)}s)`);
        return agent.status;
      }

      // Too long without podName - mark as failed
      this.logger.warn(`Agent ${agentId} has been STARTING for ${Math.round(ageMs / 1000)}s without podName, marking as FAILED`);
      await this.prisma.agentInstance.update({
        where: { id: agentId },
        data: {
          status: AgentStatus.FAILED,
          stoppedAt: new Date(),
          lastError: 'Pod creation timeout',
        },
      });
      return AgentStatus.FAILED;
    }

    // Agent without podName that's not starting = orphaned, mark as STOPPED
    if (!agent.podName) {
      if (agent.status === AgentStatus.RUNNING) {
        this.logger.warn(`Agent ${agentId} has no podName but status is RUNNING, marking as STOPPED`);
        await this.prisma.agentInstance.update({
          where: { id: agentId },
          data: {
            status: AgentStatus.STOPPED,
            stoppedAt: new Date(),
          },
        });
        return AgentStatus.STOPPED;
      }
      return agent.status;
    }

    // Don't override STOPPING state - this is controlled by manual stop action
    if (agent.status === AgentStatus.STOPPING) {
      return agent.status;
    }

    try {
      const podStatus = await this.k8s.getPodStatus(agent.podName);
      const actualStatus = this.mapPodPhaseToAgentStatus(podStatus);

      // Log when pod doesn't exist
      if (!podStatus) {
        this.logger.debug(`Agent ${agentId} pod ${agent.podName} not found in K8s, status will be ${actualStatus}`);
      }

      // Only update if status changed
      if (actualStatus && actualStatus !== agent.status) {
        this.logger.log(
          `Agent ${agentId} status changed from ${agent.status} to ${actualStatus} (pod: ${agent.podName})`
        );

        await this.prisma.agentInstance.update({
          where: { id: agentId },
          data: {
            status: actualStatus,
            stoppedAt: actualStatus === AgentStatus.STOPPED || actualStatus === AgentStatus.FAILED
              ? new Date()
              : null,
          },
        });

        return actualStatus;
      }

      return agent.status;
    } catch (error) {
      this.logger.error(`Failed to sync agent status for ${agentId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Create an agent instance for a session.
   * Creates a K8s pod that connects back to session-management-server via gRPC.
   * Session management server handles ALL LiveKit communication.
   *
   * @param sessionId - The session ID
   * @param createAgentDto - Agent creation parameters
   * @param userId - The user creating the agent (for env var template access)
   */
  async create(sessionId: string, createAgentDto: CreateAgentDto, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true, project: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (!session.room) {
      throw new NotFoundException('Session does not have an associated room');
    }

    // Determine agent type (default to stella-agent)
    const agentType = createAgentDto.agentType || 'stella-agent';

    // Agent config is passed directly from the request (plan_id, etc.)
    const agentConfig = createAgentDto.config || {};

    // 1. Create agent record (status=STARTING, no podName yet)
    const agent = await this.prisma.agentInstance.create({
      data: {
        sessionId,
        name: createAgentDto.name,
        icon: createAgentDto.icon || '🤖',
        agentConfig: agentConfig as Prisma.InputJsonValue,
        agentType,
        status: AgentStatus.STARTING,
        healthState: 'initializing',
      },
    });

    this.logger.log(`Created agent ${agent.id} (type: ${agentType}) for session ${sessionId}`);

    // 2. Emit SSE event: agent.starting
    if (this.sessionsService) {
      this.sessionsService.emitAgentStarting(sessionId, agent.id, createAgentDto.name, agentType);
    }

    // 3. Register pending session for gRPC agent connection (non-blocking)
    if (this.agentServerService) {
      const config: Record<string, string> = {
        sessionId: session.id,
        roomName: session.room.livekitRoomName,
        projectId: session.projectId,
        agentName: createAgentDto.name,
        agentId: agent.id,
      };

      this.agentServerService.registerPendingSession(sessionId, agentType, config);
      this.logger.log(`Registered pending session ${sessionId} for agent type: ${agentType}`);
    }

    // 4. Create K8s pod asynchronously (don't block response)
    // NOTE: In the new architecture, agents connect directly to LiveKit rooms via SDK
    // No need for session-management-server to join rooms
    this.createAgentPodAsync(agent.id, session, createAgentDto, agentType, userId);

    return agent;
  }

  /**
   * Async K8s pod creation - runs in background, updates DB on completion/failure.
   */
  private async createAgentPodAsync(
    agentId: string,
    session: { id: string; projectId: string; room: { livekitRoomName: string; serverUrl: string } | null },
    createAgentDto: CreateAgentDto,
    agentType: string,
    userId: string,
  ): Promise<void> {
    try {
      // Get environment variables for LiveKit (agent pod needs these for gRPC config)
      const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY');
      const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
      const livekitUrl = this.configService.get<string>('LIVEKIT_URL', session.room?.serverUrl || '');

      if (!livekitApiKey || !livekitApiSecret) {
        throw new Error('Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET');
      }

      // Create K8s pod - agent connects directly to LiveKit via SDK
      const { podName, secretName } = await this.k8s.createAgentPod({
        agentId,
        sessionId: session.id,
        projectId: session.projectId,
        userId,
        agentName: createAgentDto.name,
        agentIcon: createAgentDto.icon || '🤖',
        agentType,
        roomName: session.room?.livekitRoomName || '',
        livekitUrl,
        livekitApiKey,
        livekitApiSecret,
        ttsProvider: this.configService.get<string>('TTS_PROVIDER', 'opensource'),
        agentConfig: createAgentDto.config || {},
        forceRebuild: createAgentDto.forceRebuild,
        envVarTemplateId: createAgentDto.envVarTemplateId,
      });

      // Update agent with pod info
      await this.prisma.agentInstance.update({
        where: { id: agentId },
        data: { podName, secretName },
      });

      this.logger.log(`Created K8s pod ${podName} for agent ${agentId}`);

      // Status will change to RUNNING when agent connects via gRPC
      // (detected via AgentServerService.handleRegisterAgent)

    } catch (error) {
      this.logger.error(`Failed to create pod for agent ${agentId}: ${error.message}`);

      await this.prisma.agentInstance.update({
        where: { id: agentId },
        data: {
          status: AgentStatus.FAILED,
          stoppedAt: new Date(),
          lastError: error.message,
        },
      });

      // Emit SSE event: agent.failed
      if (this.sessionsService) {
        this.sessionsService.emitAgentFailed(session.id, agentId, createAgentDto.name, error.message);
      }
    }
  }

  /**
   * Create an agent that runs as a standalone gRPC service.
   * The agent pod connects back to session-management via gRPC.
   * @param sessionId - The session ID
   * @param createAgentDto - Agent creation parameters
   * @param grpcAddress - The gRPC address where the agent will listen (e.g., "agent-pod:50051")
   */
  async createStandaloneAgent(sessionId: string, createAgentDto: CreateAgentDto, grpcAddress?: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true, project: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (!session.room) {
      throw new Error('Session does not have an associated room');
    }

    // Determine agent type (default to stella-agent)
    const agentType = createAgentDto.agentType || 'stella-agent';

    // Create agent record with gRPC address
    const agent = await this.prisma.agentInstance.create({
      data: {
        sessionId,
        name: createAgentDto.name,
        icon: createAgentDto.icon || '🤖',
        agentConfig: (createAgentDto.config || {}) as Prisma.InputJsonValue,
        agentType,  // Store agent type for restarts
        status: AgentStatus.STARTING,
        healthState: 'initializing',
        grpcAddress: grpcAddress || null,
      },
    });

    this.logger.log(`Created standalone agent ${agent.id} (type: ${agentType}) for session ${sessionId}`);

    // Register pending session with AgentServerService
    if (this.agentServerService) {
      const config: Record<string, string> = {
        sessionId: session.id,
        roomName: session.room.livekitRoomName,
        projectId: session.projectId,
        agentName: createAgentDto.name,
      };

      this.agentServerService.registerPendingSession(sessionId, agentType, config);
      this.logger.log(`Registered pending session ${sessionId} for standalone agent`);
    }

    // NOTE: In the new architecture, agents connect directly to LiveKit rooms via SDK
    // No need for session-management-server to join rooms

    return agent;
  }

  /**
   * Update the gRPC address for an agent (called when agent pod starts and reports its address).
   */
  async updateGrpcAddress(agentId: string, grpcAddress: string): Promise<void> {
    await this.prisma.agentInstance.update({
      where: { id: agentId },
      data: { grpcAddress },
    });
    this.logger.log(`Updated gRPC address for agent ${agentId}: ${grpcAddress}`);
  }

  async findOne(id: string) {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            room: true,
          },
        },
      },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    // Get pod status if pod exists
    let podStatus = null;
    if (agent.podName) {
      podStatus = await this.k8s.getPodStatus(agent.podName);
    }

    return {
      ...agent,
      podStatus,
    };
  }

  async getLogs(id: string): Promise<string> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    if (!agent.podName) {
      throw new BadRequestException('Agent pod not found');
    }

    return this.k8s.getPodLogs(agent.podName);
  }

  async streamLogs(id: string, callback: (chunk: string) => void, onError?: (error: Error) => void): Promise<() => void> {
    // Poll for agent to have a podName (pod creation is async)
    const maxWaitMs = 60000; // 60 seconds max wait
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    let agent = await this.prisma.agentInstance.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    // If no podName yet, wait for pod creation
    while (!agent.podName && (Date.now() - startTime) < maxWaitMs) {
      callback(`[Waiting for pod creation...]\n`);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      agent = await this.prisma.agentInstance.findUnique({
        where: { id },
      });

      if (!agent) {
        throw new NotFoundException(`Agent with ID ${id} not found`);
      }

      // Check if agent failed during pod creation
      if (agent.status === 'FAILED') {
        callback(`[Pod creation failed: ${agent.lastError || 'Unknown error'}]\n`);
        throw new BadRequestException(`Pod creation failed: ${agent.lastError || 'Unknown error'}`);
      }
    }

    if (!agent.podName) {
      callback(`[Timeout waiting for pod creation after ${maxWaitMs / 1000}s]\n`);
      throw new BadRequestException('Timeout waiting for pod creation');
    }

    callback(`[Connected to pod: ${agent.podName}]\n`);
    return await this.k8s.streamPodLogs(agent.podName, callback, onError);
  }

  // ============================================================================
  // Centralized Agent Lifecycle Management
  // All agent stop/delete operations should use these core functions
  // ============================================================================

  /**
   * Stop an agent - core logic used by remove(), session close, etc.
   * Handles room disconnection, K8s resource cleanup, and DB status update.
   * @returns The updated agent instance
   */
  async stopAgent(id: string): Promise<any> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    // Update status to STOPPING
    await this.prisma.agentInstance.update({
      where: { id },
      data: {
        status: AgentStatus.STOPPING,
      },
    });

    // NOTE: In the new architecture, agents connect directly to LiveKit rooms via SDK
    // Agent pod deletion will automatically disconnect from LiveKit

    // Clean up K8s resources (pod, secret, configmap)
    // This is critical to prevent zombie containers from accumulating
    await this.cleanupK8sResources(agent);

    // Update final status to STOPPED
    const stoppedAgent = await this.prisma.agentInstance.update({
      where: { id },
      data: {
        status: AgentStatus.STOPPED,
        stoppedAt: new Date(),
        // Clear K8s resource names since they're deleted
        podName: null,
        secretName: null,
        configMapName: null,
      },
    });

    // Emit SSE event: agent.stopped - this disables audio processing in frontend
    if (this.sessionsService) {
      this.sessionsService.emitAgentStopped(agent.sessionId, id, agent.name);
    }

    this.logger.log(`Agent ${id} stopped successfully`);
    return stoppedAgent;
  }

  /**
   * Clean up Kubernetes resources for an agent.
   * Deletes pod, secret, and configmap if they exist.
   */
  private async cleanupK8sResources(agent: { id: string; podName: string | null; secretName: string | null; configMapName: string | null }): Promise<void> {
    const cleanupTasks: Promise<void>[] = [];

    if (agent.podName) {
      this.logger.log(`Deleting pod ${agent.podName} for agent ${agent.id}`);
      cleanupTasks.push(
        this.k8s.deletePod(agent.podName).catch(error => {
          this.logger.warn(`Failed to delete pod ${agent.podName}: ${error.message}`);
        })
      );
    }

    if (agent.secretName) {
      this.logger.log(`Deleting secret ${agent.secretName} for agent ${agent.id}`);
      cleanupTasks.push(
        this.k8s.deleteSecret(agent.secretName).catch(error => {
          this.logger.warn(`Failed to delete secret ${agent.secretName}: ${error.message}`);
        })
      );
    }

    if (agent.configMapName) {
      this.logger.log(`Deleting configmap ${agent.configMapName} for agent ${agent.id}`);
      cleanupTasks.push(
        this.k8s.deleteConfigMap(agent.configMapName).catch(error => {
          this.logger.warn(`Failed to delete configmap ${agent.configMapName}: ${error.message}`);
        })
      );
    }

    // Wait for all cleanup tasks to complete
    if (cleanupTasks.length > 0) {
      await Promise.all(cleanupTasks);
      this.logger.log(`K8s cleanup complete for agent ${agent.id}`);
    }
  }

  /**
   * Delete an agent - stops first if needed, then removes from DB.
   * Used by session deletion, manual cleanup, etc.
   */
  async deleteAgent(id: string): Promise<void> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    // Stop if running (will handle K8s cleanup)
    if (agent.status === AgentStatus.RUNNING || agent.status === AgentStatus.STARTING) {
      await this.stopAgent(id);
    } else if (agent.status === AgentStatus.STOPPED || agent.status === AgentStatus.FAILED) {
      // For already stopped/failed agents, clean up K8s resources if they still exist
      // This catches any zombie containers that weren't cleaned up properly
      await this.cleanupK8sResources(agent);
    }

    // Delete from database
    await this.prisma.agentInstance.delete({
      where: { id },
    });

    this.logger.log(`Agent ${id} deleted from database`);
  }

  /**
   * Stop all agents for a session.
   * Used by session close and session delete.
   */
  async stopAllSessionAgents(sessionId: string): Promise<void> {
    this.logger.debug(`stopAllSessionAgents: querying agents for session ${sessionId}`);

    const agents = await this.prisma.agentInstance.findMany({
      where: {
        sessionId,
        status: { in: [AgentStatus.RUNNING, AgentStatus.STARTING] },
      },
    });

    this.logger.debug(`stopAllSessionAgents: found ${agents.length} agents`);

    if (agents.length === 0) {
      this.logger.debug(`No running agents to stop for session ${sessionId}`);
      return;
    }

    this.logger.log(`Stopping ${agents.length} agents for session ${sessionId}`);

    // Stop all agents in parallel with a timeout to prevent hanging
    const STOP_TIMEOUT_MS = 30000; // 30 second timeout per agent

    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout stopping agent ${agent.id}`)), STOP_TIMEOUT_MS)
        );

        try {
          return await Promise.race([
            this.stopAgent(agent.id),
            timeoutPromise,
          ]);
        } catch (error) {
          this.logger.error(`Error stopping agent ${agent.id}: ${error.message}`);
          // Force update DB status to STOPPED even if stop failed
          await this.prisma.agentInstance.update({
            where: { id: agent.id },
            data: { status: AgentStatus.STOPPED, stoppedAt: new Date() },
          }).catch(e => this.logger.error(`Failed to force-stop agent ${agent.id}: ${e.message}`));
          throw error;
        }
      })
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(`Failed to stop agent ${agents[index].id}: ${result.reason}`);
      }
    });

    this.logger.log(`Finished stopping agents for session ${sessionId}`);
  }

  /**
   * Restart an agent - recreates pod/secret with same agent ID.
   * Used for config changes, troubleshooting, etc.
   * Unlike stopAgent(), this keeps the same agent ID and replaces it in-place.
   */
  async restartAgent(id: string): Promise<any> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
      include: { session: { include: { room: true, project: true } } },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    if (!agent.session.room) {
      throw new Error('Session does not have an associated room');
    }

    this.logger.log(`Restarting agent ${id} (keeping same ID)`);

    // Delete Kubernetes resources (pod + secret) without updating DB status
    try {
      if (agent.podName) {
        await this.k8s.deletePod(agent.podName);
      }
      if (agent.secretName) {
        await this.k8s.deleteSecret(agent.secretName);
      }
    } catch (error) {
      this.logger.error(`K8s cleanup failed for agent ${id}: ${error.message}`);
    }

    // Update agent status to STARTING
    await this.prisma.agentInstance.update({
      where: { id },
      data: {
        status: AgentStatus.STARTING,
        stoppedAt: null,
      },
    });

    // Get environment variables
    const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');

    if (!livekitApiKey || !livekitApiSecret) {
      const missing: string[] = [];
      if (!livekitApiKey) missing.push('LIVEKIT_API_KEY');
      if (!livekitApiSecret) missing.push('LIVEKIT_API_SECRET');
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    const livekitUrl = this.configService.get<string>('LIVEKIT_URL', agent.session.room.serverUrl);

    this.logger.log(
      `🔗 Agent ${id} reconnecting to LiveKit room: "${agent.session.room.livekitRoomName}" at ${livekitUrl}`
    );

    // Get the user ID from the project membership (first owner/admin)
    const projectMembership = await this.prisma.projectMembership.findFirst({
      where: {
        projectId: agent.session.projectId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
    });

    // Recreate Kubernetes pod with SAME agent ID
    try {
      const { podName, secretName } = await this.k8s.createAgentPod({
        agentId: id, // SAME ID - this ensures pod/secret are unique to this agent
        sessionId: agent.sessionId,
        projectId: agent.session.projectId,
        userId: projectMembership?.userId || '', // Get user from project for env var access
        agentName: agent.name,
        agentIcon: agent.icon || '🤖',
        roomName: agent.session.room.livekitRoomName,
        livekitUrl,
        livekitApiKey,
        livekitApiSecret,
        ttsProvider: this.configService.get<string>('TTS_PROVIDER', 'opensource'),
        agentConfig: (agent.agentConfig as Record<string, unknown>) || {},
        agentType: agent.agentType || 'stella-agent',  // Use stored agent type for image selection
        // Note: envVarTemplateId not passed on restart - uses same config as original
      });

      // Update agent with new pod info
      const updatedAgent = await this.prisma.agentInstance.update({
        where: { id },
        data: {
          podName,
          secretName,
          status: AgentStatus.RUNNING,
        },
      });

      this.logger.log(`Agent ${id} restarted successfully with pod ${podName}`);
      return updatedAgent;
    } catch (error) {
      // Update agent status to FAILED
      await this.prisma.agentInstance.update({
        where: { id },
        data: {
          status: AgentStatus.FAILED,
          stoppedAt: new Date(),
        },
      });

      this.logger.error(`Failed to restart agent ${id}: ${error.message}`);
      throw new BadRequestException(`Failed to restart agent: ${error.message}`);
    }
  }

  // ============================================================================
  // Public API Endpoints (delegate to core functions)
  // ============================================================================

  async remove(id: string) {
    // Delegate to centralized stop logic
    await this.stopAgent(id);
    return { message: 'Agent stopped successfully' };
  }

  async delete(id: string) {
    // Delegate to centralized delete logic (handles stopping if needed)
    await this.deleteAgent(id);
    return { message: 'Agent deleted successfully' };
  }

  async restart(id: string) {
    // Delegate to centralized restart logic
    return await this.restartAgent(id);
  }
}
