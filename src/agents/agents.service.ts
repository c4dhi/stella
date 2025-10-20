import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { AgentStatus } from '@prisma/client';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private prisma: PrismaService,
    private k8s: KubernetesService,
    private configService: ConfigService,
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
   * Sync agent status from Kubernetes pod status
   */
  async syncAgentStatus(agentId: string): Promise<AgentStatus | null> {
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id: agentId },
    });

    if (!agent || !agent.podName) {
      return null;
    }

    // Don't override STOPPING state - this is controlled by manual stop action
    if (agent.status === AgentStatus.STOPPING) {
      return agent.status;
    }

    try {
      const podStatus = await this.k8s.getPodStatus(agent.podName);
      const actualStatus = this.mapPodPhaseToAgentStatus(podStatus);

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

  async create(sessionId: string, createAgentDto: CreateAgentDto) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true, project: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    // Create agent record
    const agent = await this.prisma.agentInstance.create({
      data: {
        sessionId,
        name: createAgentDto.name,
        icon: createAgentDto.icon || '🤖',  // Default robot emoji
        planId: createAgentDto.planId,
        status: AgentStatus.STARTING,
      },
    });

    // Create Kubernetes pod
    try {
      if (!session.room) {
        throw new Error('Session does not have an associated room');
      }

      const livekitApiKey = this.configService.get<string>('LIVEKIT_API_KEY');
      const livekitApiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');

      if (!livekitApiKey || !livekitApiSecret) {
        const missing: string[] = [];
        if (!livekitApiKey) missing.push('LIVEKIT_API_KEY');
        if (!livekitApiSecret) missing.push('LIVEKIT_API_SECRET');
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
      }

      // Note: OpenAI API key is now read directly by agent from grace-ai-secrets

      // Use current LIVEKIT_URL from environment, not the stored serverUrl
      // This ensures agents always connect to the correct LiveKit server
      // regardless of when the session was created
      const livekitUrl = this.configService.get<string>('LIVEKIT_URL', session.room.serverUrl);

      // Log room connection details for verification
      this.logger.log(
        `🔗 Agent ${agent.id} connecting to LiveKit room: "${session.room.livekitRoomName}" at ${livekitUrl}`
      );

      const { podName, secretName } = await this.k8s.createAgentPod({
        agentId: agent.id,
        sessionId: session.id,
        projectId: session.projectId,
        agentName: createAgentDto.name,
        agentIcon: createAgentDto.icon || '🤖',
        roomName: session.room.livekitRoomName,
        livekitUrl,
        livekitApiKey,
        livekitApiSecret,
        // openaiApiKey removed - now from grace-ai-secrets
        ttsProvider: this.configService.get<string>('TTS_PROVIDER', 'opensource'),
        planId: createAgentDto.planId,
      });

      // Update agent with pod info
      const updatedAgent = await this.prisma.agentInstance.update({
        where: { id: agent.id },
        data: {
          podName,
          secretName,
          status: AgentStatus.RUNNING,
        },
      });

      this.logger.log(`Agent ${agent.id} started with pod ${podName}`);
      return updatedAgent;
    } catch (error) {
      // Update agent status to FAILED
      await this.prisma.agentInstance.update({
        where: { id: agent.id },
        data: {
          status: AgentStatus.FAILED,
          stoppedAt: new Date(),
        },
      });

      this.logger.error(`Failed to start agent ${agent.id}: ${error.message}`);

      // Provide helpful error message for common issues
      let errorMessage = error.message;
      if (error.message.includes('OPENAI_API_KEY') || error.message.includes('API key')) {
        errorMessage = `Failed to start agent: Invalid or missing OpenAI API key. Please update OPENAI_API_KEY in .env and restart the server.`;
      }

      throw new BadRequestException(errorMessage);
    }
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
    const agent = await this.prisma.agentInstance.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    if (!agent.podName) {
      throw new BadRequestException('Agent pod not found');
    }

    return await this.k8s.streamPodLogs(agent.podName, callback, onError);
  }

  // ============================================================================
  // Centralized Agent Lifecycle Management
  // All agent stop/delete operations should use these core functions
  // ============================================================================

  /**
   * Stop an agent - core logic used by remove(), session close, etc.
   * Handles K8s pod/secret deletion and DB status update.
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

    // Delete Kubernetes resources (pod + secret)
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

    // Update final status to STOPPED
    const stoppedAgent = await this.prisma.agentInstance.update({
      where: { id },
      data: {
        status: AgentStatus.STOPPED,
        stoppedAt: new Date(),
      },
    });

    this.logger.log(`Agent ${id} stopped successfully`);
    return stoppedAgent;
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
      try {
        if (agent.podName) {
          await this.k8s.deletePod(agent.podName).catch(() => {
            this.logger.warn(`Pod ${agent.podName} not found during deletion`);
          });
        }
        if (agent.secretName) {
          await this.k8s.deleteSecret(agent.secretName).catch(() => {
            this.logger.warn(`Secret ${agent.secretName} not found during deletion`);
          });
        }
      } catch (error) {
        this.logger.warn(`K8s cleanup warning for agent ${id}: ${error.message}`);
      }
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
    const agents = await this.prisma.agentInstance.findMany({
      where: {
        sessionId,
        status: { in: [AgentStatus.RUNNING, AgentStatus.STARTING] },
      },
    });

    if (agents.length === 0) {
      this.logger.debug(`No running agents to stop for session ${sessionId}`);
      return;
    }

    this.logger.log(`Stopping ${agents.length} agents for session ${sessionId}`);

    // Stop all agents in parallel for speed
    const results = await Promise.allSettled(
      agents.map(agent => this.stopAgent(agent.id))
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

    // Recreate Kubernetes pod with SAME agent ID
    try {
      const { podName, secretName } = await this.k8s.createAgentPod({
        agentId: id, // SAME ID - this ensures pod/secret are unique to this agent
        sessionId: agent.sessionId,
        projectId: agent.session.projectId,
        agentName: agent.name,
        agentIcon: agent.icon || '🤖',
        roomName: agent.session.room.livekitRoomName,
        livekitUrl,
        livekitApiKey,
        livekitApiSecret,
        ttsProvider: this.configService.get<string>('TTS_PROVIDER', 'opensource'),
        planId: agent.planId || undefined,
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
