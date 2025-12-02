import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AgentType } from '@prisma/client'

export interface AgentTypeInfo {
  id: string
  slug: string
  name: string
  description: string
  icon: string | null
  version: string
  isBuiltIn: boolean
  capabilities: string[]
  defaultConfig: Record<string, unknown>  // Default config for this agent type
}

@Injectable()
export class AgentTypeService {
  private readonly logger = new Logger(AgentTypeService.name)

  constructor(private prisma: PrismaService) {}

  /**
   * Get all approved agent types for display in the gallery
   */
  async findAll(): Promise<AgentType[]> {
    return this.prisma.agentType.findMany({
      where: { validationStatus: 'approved' },
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    })
  }

  /**
   * Find an agent type by its unique slug
   */
  async findBySlug(slug: string): Promise<AgentType | null> {
    return this.prisma.agentType.findUnique({ where: { slug } })
  }

  /**
   * Find an agent type by its UUID
   */
  async findById(id: string): Promise<AgentType | null> {
    return this.prisma.agentType.findUnique({ where: { id } })
  }

  /**
   * Get all agent types formatted for the frontend gallery
   */
  async getAgentTypesForGallery(): Promise<AgentTypeInfo[]> {
    const types = await this.findAll()

    return types.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      version: t.version,
      isBuiltIn: t.isBuiltIn,
      capabilities: (t.capabilities as string[]) || [],
      defaultConfig: (t.defaultConfig as Record<string, unknown>) || {},
    }))
  }
}
