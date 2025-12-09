import {
  Injectable,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';
import { CreateEnvVarTemplateDto } from './dto/create-env-var-template.dto';
import { UpdateEnvVarTemplateDto } from './dto/update-env-var-template.dto';

/**
 * Response type for env var templates (without sensitive values)
 */
export interface EnvVarTemplateResponse {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  variableKeys: string[];
  agentTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EnvVarTemplatesService {
  private readonly logger = new Logger(EnvVarTemplatesService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  /**
   * Create a new environment variable template
   */
  async create(
    userId: string,
    dto: CreateEnvVarTemplateDto,
  ): Promise<EnvVarTemplateResponse> {
    this.logger.log(
      `Creating env var template "${dto.name}" for user ${userId}`,
    );

    // Encrypt the variables
    const encryptedVariables = this.encryption.encrypt(dto.variables);

    const template = await this.prisma.envVarTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        variables: encryptedVariables,
        agentTypeId: dto.agentTypeId,
        userId,
      },
    });

    return this.toResponse(template);
  }

  /**
   * Find all templates for a user
   */
  async findAllByUser(userId: string): Promise<EnvVarTemplateResponse[]> {
    const templates = await this.prisma.envVarTemplate.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    return templates.map((t) => this.toResponse(t));
  }

  /**
   * Find all templates for a user, optionally filtered by agent type
   */
  async findByAgentType(
    userId: string,
    agentTypeId?: string,
  ): Promise<EnvVarTemplateResponse[]> {
    const templates = await this.prisma.envVarTemplate.findMany({
      where: {
        userId,
        OR: [
          { agentTypeId: null }, // Generic templates
          { agentTypeId: agentTypeId }, // Agent-specific templates
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    return templates.map((t) => this.toResponse(t));
  }

  /**
   * Find a single template by ID
   */
  async findOne(id: string, userId: string): Promise<EnvVarTemplateResponse> {
    const template = await this.prisma.envVarTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Env var template with ID ${id} not found`);
    }

    if (template.userId !== userId) {
      throw new NotFoundException(`Env var template with ID ${id} not found`);
    }

    return this.toResponse(template);
  }

  /**
   * Update an existing template
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateEnvVarTemplateDto,
  ): Promise<EnvVarTemplateResponse> {
    // Verify ownership
    await this.findOne(id, userId);

    const updateData: any = {
      name: dto.name,
      description: dto.description,
      agentTypeId: dto.agentTypeId,
    };

    // Only encrypt and update variables if provided
    if (dto.variables) {
      updateData.variables = this.encryption.encrypt(dto.variables);
    }

    // Remove undefined values
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const template = await this.prisma.envVarTemplate.update({
      where: { id },
      data: updateData,
    });

    return this.toResponse(template);
  }

  /**
   * Delete a template
   */
  async remove(id: string, userId: string): Promise<{ message: string }> {
    const template = await this.findOne(id, userId);

    this.logger.log(
      `Deleting env var template ${id} (${template.name}) for user ${userId}`,
    );

    await this.prisma.envVarTemplate.delete({
      where: { id },
    });

    return { message: 'Environment variable template deleted successfully' };
  }

  /**
   * Duplicate a template
   */
  async duplicate(
    id: string,
    userId: string,
  ): Promise<EnvVarTemplateResponse> {
    const existingTemplate = await this.prisma.envVarTemplate.findUnique({
      where: { id },
    });

    if (!existingTemplate) {
      throw new NotFoundException(`Env var template with ID ${id} not found`);
    }

    if (existingTemplate.userId !== userId) {
      throw new NotFoundException(`Env var template with ID ${id} not found`);
    }

    this.logger.log(
      `Duplicating env var template ${id} (${existingTemplate.name}) for user ${userId}`,
    );

    // Copy the encrypted variables directly (no need to decrypt/re-encrypt)
    const template = await this.prisma.envVarTemplate.create({
      data: {
        name: `${existingTemplate.name} (Copy)`,
        description: existingTemplate.description,
        variables: existingTemplate.variables,
        agentTypeId: existingTemplate.agentTypeId,
        userId,
      },
    });

    return this.toResponse(template);
  }

  /**
   * Get decrypted variables for a template
   * SECURITY: Only call this during pod creation, never expose to API
   */
  async getDecryptedVariables(
    id: string,
    userId: string,
  ): Promise<Record<string, string>> {
    const template = await this.prisma.envVarTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`Env var template with ID ${id} not found`);
    }

    if (template.userId !== userId) {
      throw new ForbiddenException('Access denied to this template');
    }

    return this.encryption.decrypt(template.variables);
  }

  /**
   * Validate that user has access to a template
   */
  async validateAccess(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);
  }

  /**
   * Convert database entity to safe response (without encrypted values)
   */
  private toResponse(template: {
    id: string;
    userId: string;
    name: string;
    description: string | null;
    variables: string;
    agentTypeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): EnvVarTemplateResponse {
    return {
      id: template.id,
      userId: template.userId,
      name: template.name,
      description: template.description,
      variableKeys: this.encryption.getKeys(template.variables),
      agentTypeId: template.agentTypeId,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
