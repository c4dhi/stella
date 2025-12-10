import { Injectable, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectStatsDto } from './dto/project-stats.dto';
import { UpdatePublicConfigDto } from './dto/update-public-config.dto';
import { SessionStatus, AgentStatus } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AgentsService))
    private agentsService: AgentsService,
  ) {}

  async create(createProjectDto: CreateProjectDto, userId: string) {
    // Create project with owner membership in a transaction
    return this.prisma.project.create({
      data: {
        ...createProjectDto,
        memberships: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
      include: {
        memberships: true,
      },
    });
  }

  async findAll() {
    const projects = await this.prisma.project.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        isPublic: true,
        publicToken: true,
        publicEnabled: true,
        _count: {
          select: {
            sessions: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get additional counts for each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        const activeSessions = await this.prisma.session.count({
          where: {
            projectId: project.id,
            status: SessionStatus.ACTIVE,
          },
        });

        const activeAgents = await this.prisma.agentInstance.count({
          where: {
            session: {
              projectId: project.id,
            },
            status: AgentStatus.RUNNING,
          },
        });

        return {
          ...project,
          activeSessions,
          activeAgents,
          totalSessions: project._count.sessions,
        };
      }),
    );

    return projectsWithCounts;
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        sessions: {
          include: {
            _count: {
              select: {
                agents: true,
                participants: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return project;
  }

  async getStats(id: string): Promise<ProjectStatsDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    const [
      totalSessions,
      activeSessions,
      totalMessages,
      totalParticipants,
      agents,
    ] = await Promise.all([
      this.prisma.session.count({
        where: { projectId: id },
      }),
      this.prisma.session.count({
        where: {
          projectId: id,
          status: SessionStatus.ACTIVE,
        },
      }),
      this.prisma.message.count({
        where: {
          session: {
            projectId: id,
          },
        },
      }),
      this.prisma.participant.count({
        where: {
          session: {
            projectId: id,
          },
        },
      }),
      this.prisma.agentInstance.findMany({
        where: {
          session: {
            projectId: id,
          },
        },
        select: {
          status: true,
        },
      }),
    ]);

    const totalAgents = agents.length;
    const activeAgents = agents.filter((a) => a.status === AgentStatus.RUNNING)
      .length;

    return {
      totalSessions,
      activeSessions,
      totalAgents,
      activeAgents,
      totalMessages,
      totalParticipants,
    };
  }

  async update(id: string, updateProjectDto: UpdateProjectDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    return this.prisma.project.update({
      where: { id },
      data: updateProjectDto,
    });
  }

  async remove(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        sessions: {
          select: { id: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    this.logger.log(
      `Deleting project ${id} (${project.name}) - stopping all agents and cleaning up ${project.sessions.length} sessions`,
    );

    // Stop all agents for each session before deleting
    // This ensures K8s pods, secrets, and configmaps are properly cleaned up
    for (const session of project.sessions) {
      this.logger.log(`Stopping agents for session ${session.id}`);
      try {
        await this.agentsService.stopAllSessionAgents(session.id);
      } catch (error) {
        this.logger.warn(
          `Failed to stop agents for session ${session.id}: ${error.message}`,
        );
        // Continue with deletion even if agent stop fails
      }
    }

    // Now delete the project - Prisma cascade will delete sessions, invitations, etc.
    await this.prisma.project.delete({
      where: { id },
    });

    this.logger.log(
      `Project ${id} deleted - all agents stopped, all data removed`,
    );

    return { message: 'Project deleted successfully' };
  }

  /**
   * Update public project configuration
   * Allows configuring a project as public with agent, visualizer, and expiration settings
   */
  async updatePublicConfig(id: string, dto: UpdatePublicConfigDto) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    // Validate agent type if provided
    if (dto.agentTypeId) {
      const agentType = await this.prisma.agentType.findUnique({
        where: { id: dto.agentTypeId },
      });
      if (!agentType) {
        throw new NotFoundException(`Agent type with ID ${dto.agentTypeId} not found`);
      }
    }

    // Build the update data
    const updateData: any = {
      isPublic: dto.isPublic,
    };

    // Only set public-specific fields if making the project public
    if (dto.isPublic) {
      if (dto.agentTypeId !== undefined) {
        updateData.publicAgentTypeId = dto.agentTypeId;
      }
      if (dto.agentConfig !== undefined) {
        updateData.publicAgentConfig = dto.agentConfig;
      }
      if (dto.visualizerType !== undefined) {
        updateData.publicVisualizerType = dto.visualizerType;
      }
      if (dto.visualizerLocked !== undefined) {
        updateData.publicVisualizerLocked = dto.visualizerLocked;
      }
      if (dto.expiresAt !== undefined) {
        updateData.publicExpiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      }
      if (dto.enabled !== undefined) {
        updateData.publicEnabled = dto.enabled;
      }
    } else {
      // When making private, optionally clear public config
      // Keep the publicToken so it can be re-enabled without losing the link
      updateData.publicEnabled = false;
    }

    const updatedProject = await this.prisma.project.update({
      where: { id },
      data: updateData,
      include: {
        publicAgentType: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
          },
        },
      },
    });

    this.logger.log(
      `Updated public config for project ${id}: isPublic=${dto.isPublic}`,
    );

    return updatedProject;
  }

  /**
   * Get the public link for a project
   * Returns the full URL for sharing
   */
  async getPublicLink(id: string, baseUrl: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        isPublic: true,
        publicToken: true,
        publicEnabled: true,
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    if (!project.isPublic || !project.publicToken) {
      return { publicLink: null };
    }

    return {
      publicLink: `${baseUrl}/p/${project.publicToken}`,
      isEnabled: project.publicEnabled,
    };
  }
}
