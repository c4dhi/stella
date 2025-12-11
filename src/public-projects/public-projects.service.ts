import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { AgentsService } from '../agents/agents.service';
import { InvitationsService } from '../invitations/invitations.service';
import { AgentStatus } from '@prisma/client';
import { PublicProjectInfoDto, JoinPublicProjectResponseDto, StartJoinPublicProjectResponseDto, JoinProgressDto } from './dto/public-project-info.dto';

// In-memory progress state
interface ProgressState {
  step: number;
  status: 'in_progress' | 'complete' | 'failed';
  message: string;
  agentId?: string;
  invitationToken?: string;
  error?: string;
  updatedAt: Date;
}

@Injectable()
export class PublicProjectsService {
  private readonly logger = new Logger(PublicProjectsService.name);

  // Simple in-memory progress tracking
  private progressMap = new Map<string, ProgressState>();

  constructor(
    private prisma: PrismaService,
    private sessionsService: SessionsService,
    private agentsService: AgentsService,
    private invitationsService: InvitationsService,
  ) {
    // Cleanup old entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  private cleanup(): void {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
    for (const [id, state] of this.progressMap) {
      if (state.updatedAt.getTime() < cutoff) {
        this.progressMap.delete(id);
      }
    }
  }

  private updateProgress(sessionId: string, step: number, status: ProgressState['status'], message: string, extra: Partial<ProgressState> = {}): void {
    this.logger.log(`[${sessionId}] Progress: step=${step}, status=${status}, message=${message}`);
    this.progressMap.set(sessionId, {
      step,
      status,
      message,
      updatedAt: new Date(),
      ...extra,
    });
  }

  /**
   * Get public project info by token
   * Returns display info for the waiting screen
   */
  async getPublicProjectInfo(publicToken: string): Promise<PublicProjectInfoDto> {
    const project = await this.prisma.project.findUnique({
      where: { publicToken },
      include: {
        publicAgentType: {
          select: {
            name: true,
            icon: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Public project not found');
    }

    if (!project.isPublic) {
      throw new NotFoundException('This project is not public');
    }

    // Check expiration
    const isExpired = project.publicExpiresAt
      ? new Date() > project.publicExpiresAt
      : false;

    // Get agent config from JSON
    const agentConfig = project.publicAgentConfig as {
      name?: string;
      icon?: string;
    } | null;

    return {
      projectName: project.name,
      agentName: agentConfig?.name || project.publicAgentType?.name || 'Agent',
      agentIcon: agentConfig?.icon || project.publicAgentType?.icon || undefined,
      visualizerType: project.publicVisualizerType || undefined,
      visualizerLocked: project.publicVisualizerLocked,
      isExpired,
      isEnabled: project.publicEnabled,
    };
  }

  /**
   * Join a public project
   * Creates a new session, deploys the pre-configured agent,
   * waits for the agent to be ready, creates an invitation,
   * and returns the invitation token for redirect
   */
  async joinPublicProject(publicToken: string): Promise<JoinPublicProjectResponseDto> {
    // 1. Validate public project configuration
    const project = await this.prisma.project.findUnique({
      where: { publicToken },
      include: {
        publicAgentType: true,
        memberships: {
          where: { role: 'OWNER' },
          take: 1,
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Public project not found');
    }

    if (!project.isPublic) {
      throw new BadRequestException('This project is not public');
    }

    if (!project.publicEnabled) {
      throw new BadRequestException('This public project is currently disabled');
    }

    // Check expiration
    if (project.publicExpiresAt && new Date() > project.publicExpiresAt) {
      throw new BadRequestException('This public project link has expired');
    }

    // Ensure we have an agent type configured
    if (!project.publicAgentTypeId && !project.publicAgentType) {
      throw new BadRequestException('Public project has no agent configured');
    }

    // Get the owner's user ID for env var template access
    const ownerId = project.memberships[0]?.userId;
    if (!ownerId) {
      throw new BadRequestException('Project has no owner');
    }

    // Get agent config from JSON
    const agentConfig = project.publicAgentConfig as {
      name?: string;
      icon?: string;
      plan?: Record<string, unknown>;
      envVarTemplateId?: string;
    } | null;

    // 2. Create a new session
    const sessionName = `Public Session - ${new Date().toISOString().slice(0, 16)}`;
    const session = await this.sessionsService.create(project.id, {
      name: sessionName,
    });

    this.logger.log(`Created session ${session.id} for public project ${project.id}`);

    // 3. Deploy the agent with pre-configured settings
    const agent = await this.agentsService.create(
      session.id,
      {
        name: agentConfig?.name || project.publicAgentType?.name || 'Agent',
        icon: agentConfig?.icon || project.publicAgentType?.icon || '🤖',
        agentType: project.publicAgentType?.slug || 'stella-agent',
        config: agentConfig?.plan ? { plan: agentConfig.plan } : {},
        envVarTemplateId: agentConfig?.envVarTemplateId,
      },
      ownerId,
    );

    this.logger.log(`Deployed agent ${agent.id} for session ${session.id}`);

    // 4. Wait for agent to be RUNNING
    const agentReady = await this.waitForAgentReady(agent.id, session.id);
    if (!agentReady) {
      throw new BadRequestException(
        'Failed to start agent. Please try again or contact support.',
      );
    }

    this.logger.log(`Agent ${agent.id} is ready for session ${session.id}`);

    // 5. Create invitation using existing service
    const { invitation } = await this.invitationsService.create(session.id, {
      visualizerType: project.publicVisualizerType || undefined,
      visualizerLocked: project.publicVisualizerLocked,
      // Auto-generated name
    });

    this.logger.log(`Created invitation ${invitation.id} for session ${session.id}`);

    return {
      invitationToken: invitation.token,
      sessionId: session.id,
      agentId: agent.id,
    };
  }

  /**
   * Start joining a public project (non-blocking)
   * Returns sessionId immediately. Frontend polls getJoinProgress for updates.
   */
  async startJoinPublicProject(publicToken: string): Promise<StartJoinPublicProjectResponseDto> {
    const project = await this.validatePublicProject(publicToken);

    const ownerId = project.memberships[0]?.userId;
    if (!ownerId) {
      throw new BadRequestException('Project has no owner');
    }

    // Create session
    const sessionName = `Public Session - ${new Date().toISOString().slice(0, 16)}`;
    const session = await this.sessionsService.create(project.id, { name: sessionName });

    // Initialize progress
    this.updateProgress(session.id, 1, 'in_progress', 'Session created');

    // Run join process async (fire and forget)
    this.runJoinProcess(project, session.id, ownerId).catch(err => {
      this.logger.error(`Join failed: ${err.message}`);
    });

    return { sessionId: session.id };
  }

  /**
   * Get current join progress (polling endpoint)
   */
  getJoinProgress(sessionId: string): JoinProgressDto {
    const state = this.progressMap.get(sessionId);
    if (!state) {
      return { step: 0, totalSteps: 5, status: 'in_progress', message: 'Initializing...' };
    }
    return {
      step: state.step,
      totalSteps: 5,
      status: state.status,
      message: state.message,
      agentId: state.agentId,
      invitationToken: state.invitationToken,
      error: state.error,
    };
  }

  /**
   * Run the join process (async)
   */
  private async runJoinProcess(project: any, sessionId: string, ownerId: string): Promise<void> {
    try {
      const agentConfig = project.publicAgentConfig as {
        name?: string;
        icon?: string;
        plan?: Record<string, unknown>;
        envVarTemplateId?: string;
      } | null;

      // Step 2: Deploy agent
      this.updateProgress(sessionId, 2, 'in_progress', 'Deploying agent...');
      const agent = await this.agentsService.create(
        sessionId,
        {
          name: agentConfig?.name || project.publicAgentType?.name || 'Agent',
          icon: agentConfig?.icon || project.publicAgentType?.icon || '🤖',
          agentType: project.publicAgentType?.slug || 'stella-agent',
          config: agentConfig?.plan ? { plan: agentConfig.plan } : {},
          envVarTemplateId: agentConfig?.envVarTemplateId,
        },
        ownerId,
      );

      // Step 3: Wait for agent
      this.updateProgress(sessionId, 3, 'in_progress', 'Starting agent...', { agentId: agent.id });
      const ready = await this.pollAgentReady(agent.id);
      if (!ready.success) {
        this.updateProgress(sessionId, 3, 'failed', 'Agent failed to start', { error: ready.error });
        return;
      }

      // Step 4: Create invitation
      this.updateProgress(sessionId, 4, 'in_progress', 'Creating session...', { agentId: agent.id });
      const { invitation } = await this.invitationsService.create(sessionId, {
        visualizerType: project.publicVisualizerType || undefined,
        visualizerLocked: project.publicVisualizerLocked,
      });

      // Step 5: Done
      this.updateProgress(sessionId, 5, 'complete', 'Ready!', {
        agentId: agent.id,
        invitationToken: invitation.token,
      });

    } catch (error) {
      this.updateProgress(sessionId, 0, 'failed', 'Failed', { error: error.message });
    }
  }

  /**
   * Wait for agent to be ready (blocking) - used by deprecated join endpoint
   */
  private async waitForAgentReady(agentId: string, sessionId: string): Promise<boolean> {
    const result = await this.pollAgentReady(agentId);
    if (!result.success) {
      this.logger.error(`Agent ${agentId} failed to start for session ${sessionId}: ${result.error}`);
    }
    return result.success;
  }

  /**
   * Poll for agent to become RUNNING
   */
  private async pollAgentReady(agentId: string, maxWaitMs = 120000): Promise<{ success: boolean; error?: string }> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const agent = await this.prisma.agentInstance.findUnique({
        where: { id: agentId },
        select: { status: true, lastError: true },
      });

      if (!agent) return { success: false, error: 'Agent not found' };
      if (agent.status === AgentStatus.RUNNING) return { success: true };
      if (agent.status === AgentStatus.FAILED) return { success: false, error: agent.lastError || 'Failed' };
      if (agent.status === AgentStatus.STOPPED) return { success: false, error: 'Stopped' };

      await new Promise(r => setTimeout(r, 500));
    }
    return { success: false, error: 'Timeout' };
  }

  /**
   * Validate public project and return project data
   */
  private async validatePublicProject(publicToken: string) {
    const project = await this.prisma.project.findUnique({
      where: { publicToken },
      include: {
        publicAgentType: true,
        memberships: {
          where: { role: 'OWNER' },
          take: 1,
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Public project not found');
    }

    if (!project.isPublic) {
      throw new BadRequestException('This project is not public');
    }

    if (!project.publicEnabled) {
      throw new BadRequestException('This public project is currently disabled');
    }

    // Check expiration
    if (project.publicExpiresAt && new Date() > project.publicExpiresAt) {
      throw new BadRequestException('This public project link has expired');
    }

    // Ensure we have an agent type configured
    if (!project.publicAgentTypeId && !project.publicAgentType) {
      throw new BadRequestException('Public project has no agent configured');
    }

    return project;
  }

}
