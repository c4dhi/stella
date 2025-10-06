import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectStatsDto } from './dto/project-stats.dto';
import { SessionStatus, AgentStatus } from '@prisma/client';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async create(createProjectDto: CreateProjectDto) {
    return this.prisma.project.create({
      data: createProjectDto,
    });
  }

  async findAll() {
    const projects = await this.prisma.project.findMany({
      include: {
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
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }

    await this.prisma.project.delete({
      where: { id },
    });

    return { message: 'Project deleted successfully' };
  }
}
