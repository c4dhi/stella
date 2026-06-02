import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentConfigurationDto } from './dto/create-agent-configuration.dto';
import { UpdateAgentConfigurationDto } from './dto/update-agent-configuration.dto';
import { sanitizeAgentConfig } from '../common/utils/sanitize-config';
import { validateConfigurationAgainstSchema } from './configuration-compat.util';
import { deriveEffectiveAgentConfig } from '../kubernetes/utils/agent-config-injection.util';

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
   * Resolve a stored configuration for deployment to an agent of a given type.
   *
   * Enforces type + version pinning and guarantees the agent receives a complete,
   * current-schema-valid config:
   *   1. ownership (404 via findOne),
   *   2. agent-type match (400 on mismatch),
   *   3. not OUTDATED (400; precomputed by reconciliation, so this is an O(1) read),
   *   4. re-validate the overrides against the CURRENT pipelineSchema (defence in depth),
   *   5. deep-merge over the AgentType defaults so the pod always gets a full config.
   *
   * Returns the effective config object to inject as `pipeline_config`.
   */
  async resolveForDeploy(
    configId: string,
    userId: string,
    agentTypeId: string,
    agentTypeRecord: {
      version?: string | null;
      defaultConfig?: Prisma.JsonValue | null;
      pipelineSchema?: Prisma.JsonValue | null;
      configSchema?: Prisma.JsonValue | null;
    },
  ): Promise<Record<string, unknown>> {
    const cfg = await this.findOne(configId, userId); // 404 on bad ownership

    if (cfg.agentTypeId !== agentTypeId) {
      throw new BadRequestException(
        `Agent configuration ${configId} is bound to agent type ${cfg.agentTypeId}, not ${agentTypeId}`,
      );
    }

    if (cfg.compatibility === 'OUTDATED') {
      throw new BadRequestException(
        `Agent configuration ${configId} is outdated for the current agent version` +
          (agentTypeRecord.version ? ` (${agentTypeRecord.version})` : '') +
          (cfg.compatibilityNote ? `: ${cfg.compatibilityNote}` : '') +
          '. Open it in settings to review and re-save.',
      );
    }

    // Defence in depth: re-validate against the current schema before applying.
    const overrides = (cfg.configuration ?? {}) as Record<string, unknown>;
    try {
      validateConfigurationAgainstSchema(
        overrides,
        agentTypeRecord.pipelineSchema as Record<string, unknown> | null,
      );
    } catch (e) {
      throw new BadRequestException(
        `Agent configuration ${configId} is incompatible with the current agent schema: ${
          (e as Error).message
        }`,
      );
    }

    // Always merge over defaults so the agent receives a complete config.
    return deriveEffectiveAgentConfig(
      {
        slug: '',
        defaultConfig: (agentTypeRecord.defaultConfig ?? null) as
          | Record<string, unknown>
          | null,
        configSchema: (agentTypeRecord.configSchema ?? null) as
          | Record<string, unknown>
          | null,
      },
      { configuration: overrides },
    );
  }

  /**
   * Validate configuration against the agent type's pipeline schema.
   * Delegates to the shared (DI-free) checker and maps failures to HTTP 400.
   */
  private validateConfiguration(
    config: Record<string, unknown>,
    pipelineSchema: Record<string, unknown>,
  ) {
    try {
      validateConfigurationAgainstSchema(config, pipelineSchema);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
