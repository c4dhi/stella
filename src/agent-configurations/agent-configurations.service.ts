import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentConfigurationDto } from './dto/create-agent-configuration.dto';
import { UpdateAgentConfigurationDto } from './dto/update-agent-configuration.dto';
import { sanitizeAgentConfig } from '../common/utils/sanitize-config';

@Injectable()
export class AgentConfigurationsService {
  private readonly logger = new Logger(AgentConfigurationsService.name);

  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAgentConfigurationDto) {
    this.logger.log(`Creating agent configuration "${dto.name}" for user ${userId}`);

    // Verify agent type exists
    const agentType = await this.prisma.agentType.findUnique({
      where: { id: dto.agentTypeId },
    });
    if (!agentType) {
      throw new BadRequestException(`Agent type with ID ${dto.agentTypeId} not found`);
    }

    // Sanitize the configuration payload
    const sanitized = sanitizeAgentConfig(dto.configuration as Record<string, unknown>);

    // Validate against pipeline schema if available
    if (agentType.pipelineSchema) {
      this.validateConfiguration(sanitized, agentType.pipelineSchema as Record<string, unknown>);
    }

    return this.prisma.agentConfiguration.create({
      data: {
        name: dto.name,
        description: dto.description,
        agentTypeId: dto.agentTypeId,
        configuration: sanitized as Prisma.InputJsonValue,
        agentVersion: dto.agentVersion || agentType.version,
        userId,
      },
    });
  }

  async findAllByUser(userId: string, agentTypeId?: string) {
    const where: Prisma.AgentConfigurationWhereInput = { userId };
    if (agentTypeId) {
      where.agentTypeId = agentTypeId;
    }

    return this.prisma.agentConfiguration.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        agentType: {
          select: { id: true, slug: true, name: true, icon: true },
        },
      },
    });
  }

  async findOne(id: string, userId: string) {
    const config = await this.prisma.agentConfiguration.findUnique({
      where: { id },
      include: {
        agentType: {
          select: { id: true, slug: true, name: true, icon: true, pipelineSchema: true },
        },
      },
    });

    if (!config) {
      throw new NotFoundException(`Agent configuration with ID ${id} not found`);
    }

    if (config.userId !== userId) {
      throw new NotFoundException(`Agent configuration with ID ${id} not found`);
    }

    return config;
  }

  async update(id: string, userId: string, dto: UpdateAgentConfigurationDto) {
    const existing = await this.findOne(id, userId);

    const data: Prisma.AgentConfigurationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.agentVersion !== undefined) data.agentVersion = dto.agentVersion;

    if (dto.configuration !== undefined) {
      const sanitized = sanitizeAgentConfig(dto.configuration as Record<string, unknown>);

      // Validate against pipeline schema if available
      const agentType = await this.prisma.agentType.findUnique({
        where: { id: existing.agentTypeId },
      });
      if (agentType?.pipelineSchema) {
        this.validateConfiguration(sanitized, agentType.pipelineSchema as Record<string, unknown>);
      }

      data.configuration = sanitized as Prisma.InputJsonValue;
    }

    return this.prisma.agentConfiguration.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, userId: string) {
    const config = await this.findOne(id, userId);

    this.logger.log(
      `Deleting agent configuration ${id} (${config.name}) for user ${userId}`,
    );

    await this.prisma.agentConfiguration.delete({
      where: { id },
    });

    return { message: 'Agent configuration deleted successfully' };
  }

  async duplicate(id: string, userId: string) {
    const config = await this.findOne(id, userId);

    this.logger.log(
      `Duplicating agent configuration ${id} (${config.name}) for user ${userId}`,
    );

    return this.prisma.agentConfiguration.create({
      data: {
        name: `${config.name} (Copy)`,
        description: config.description,
        agentTypeId: config.agentTypeId,
        configuration: config.configuration as Prisma.InputJsonValue,
        agentVersion: config.agentVersion,
        userId,
      },
    });
  }

  /**
   * Validate configuration against the agent type's pipeline schema.
   * Checks that only known node IDs are used and threshold values are in range.
   */
  private validateConfiguration(
    config: Record<string, unknown>,
    pipelineSchema: Record<string, unknown>,
  ) {
    const nodes = pipelineSchema.nodes as Array<Record<string, unknown>> | undefined;
    const thresholds = pipelineSchema.thresholds as Array<Record<string, unknown>> | undefined;

    // Validate node overrides
    const configNodes = config.nodes as Record<string, unknown> | undefined;
    if (configNodes && nodes) {
      const knownNodeIds = new Set(nodes.map((n) => n.id as string));
      for (const nodeId of Object.keys(configNodes)) {
        if (!knownNodeIds.has(nodeId)) {
          throw new BadRequestException(`Unknown node ID in configuration: ${nodeId}`);
        }
      }
    }

    // Validate threshold values
    const configThresholds = config.thresholds as Record<string, unknown> | undefined;
    if (configThresholds && thresholds) {
      const thresholdMap = new Map(
        thresholds.map((t) => [t.id as string, t]),
      );
      for (const [key, value] of Object.entries(configThresholds)) {
        const schema = thresholdMap.get(key);
        if (!schema) {
          throw new BadRequestException(`Unknown threshold in configuration: ${key}`);
        }
        if (typeof value === 'number') {
          const min = schema.min as number | undefined;
          const max = schema.max as number | undefined;
          if (min !== undefined && value < min) {
            throw new BadRequestException(`Threshold ${key} value ${value} is below minimum ${min}`);
          }
          if (max !== undefined && value > max) {
            throw new BadRequestException(`Threshold ${key} value ${value} is above maximum ${max}`);
          }
        }
      }
    }
  }
}
