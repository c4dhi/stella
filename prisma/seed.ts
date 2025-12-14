import { PrismaClient, AgentValidationStatus, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const prisma = new PrismaClient()

// Directories to skip when scanning for agents
const SKIP_DIRS = ['stella-ai-agent-sdk']

// Validation constants (matching src/agent-package/agent-manifest.types.ts)
const SLUG_REGEX = /^[a-z][a-z0-9-]*[a-z0-9]$/
const VERSION_REGEX = /^\d+\.\d+\.\d+$/

interface AgentManifest {
  version: string
  metadata: {
    name: string
    slug: string
    version: string
    description: string
    author?: { name: string; email?: string }
    icon?: string
    tags?: string[]
  }
  capabilities?: string[]
  image: {
    dockerfile?: string
    imageUrl?: string
  }
  resources?: {
    memory?: { request?: string; limit?: string }
    cpu?: { request?: string; limit?: string }
    gpu?: boolean
  }
  configSchema?: Record<string, unknown>
  defaultConfig?: Record<string, unknown>
  sdk?: { minVersion?: string }
}

interface ManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  manifest?: AgentManifest
}

interface BuiltinAgentInfo {
  manifest: AgentManifest
  directoryPath: string
}

/**
 * Validate an agent.yaml manifest.
 * Simplified version of ManifestValidator for standalone use.
 */
function validateManifest(content: string): ManifestValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  let manifest: AgentManifest
  try {
    manifest = yaml.load(content) as AgentManifest
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid YAML: ${(error as Error).message}`],
      warnings: [],
    }
  }

  if (!manifest || typeof manifest !== 'object') {
    return {
      valid: false,
      errors: ['Manifest must be a valid YAML object'],
      warnings: [],
    }
  }

  // Validate version
  if (!manifest.version) {
    errors.push('Missing required field: version')
  } else if (manifest.version !== '1.0') {
    warnings.push(`Manifest version ${manifest.version} may not be fully supported`)
  }

  // Validate metadata
  if (!manifest.metadata) {
    errors.push('Missing required field: metadata')
  } else {
    if (!manifest.metadata.name) {
      errors.push('Missing required field: metadata.name')
    }
    if (!manifest.metadata.slug) {
      errors.push('Missing required field: metadata.slug')
    } else if (!SLUG_REGEX.test(manifest.metadata.slug)) {
      errors.push('Invalid slug: must start with a letter, contain only lowercase letters, numbers, and hyphens')
    }
    if (!manifest.metadata.version) {
      errors.push('Missing required field: metadata.version')
    } else if (!VERSION_REGEX.test(manifest.metadata.version)) {
      errors.push('Invalid version format: must be semantic version (e.g., 1.0.0)')
    }
    if (!manifest.metadata.description) {
      errors.push('Missing required field: metadata.description')
    }
  }

  // Validate image configuration
  if (!manifest.image) {
    errors.push('Missing required field: image')
  } else {
    if (!manifest.image.dockerfile && !manifest.image.imageUrl) {
      errors.push('Must specify either image.dockerfile or image.imageUrl')
    }
  }

  // Validate capabilities
  if (manifest.capabilities) {
    if (!Array.isArray(manifest.capabilities)) {
      errors.push('capabilities must be an array')
    } else {
      const validCapabilities = ['voice', 'text', 'progress', 'plans', 'experts']
      for (const cap of manifest.capabilities) {
        if (!validCapabilities.includes(cap)) {
          warnings.push(`Unknown capability: ${cap}`)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    manifest: errors.length === 0 ? manifest : undefined,
  }
}

/**
 * Discover built-in agents from the agents/ directory.
 *
 * Path resolution:
 * - In K8s: Uses AGENT_WORKSPACE_ROOT env var (mounted project directory)
 * - Local dev: Uses relative path from prisma/ to agents/
 */
function discoverBuiltinAgents(): BuiltinAgentInfo[] {
  // In K8s, the project is mounted at AGENT_WORKSPACE_ROOT
  // Locally, resolve relative to this file
  const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT || path.resolve(__dirname, '..')
  const agentsDir = path.join(workspaceRoot, 'agents')

  if (!fs.existsSync(agentsDir)) {
    throw new Error(
      `Agents directory not found: ${agentsDir}\n` +
      `If running in K8s, ensure AGENT_WORKSPACE_ROOT is set and the project is mounted.`
    )
  }

  console.log(`Discovering built-in agents from: ${agentsDir}`)

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true })
  const agentDirs = entries.filter(
    (entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name),
  )

  const agents: BuiltinAgentInfo[] = []

  for (const dir of agentDirs) {
    const agentPath = path.join(agentsDir, dir.name)
    const manifestPath = path.join(agentPath, 'agent.yaml')

    // Check manifest exists
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `Missing agent.yaml in ${dir.name}. Every built-in agent must have a manifest file.`,
      )
    }

    // Read and validate manifest
    const content = fs.readFileSync(manifestPath, 'utf-8')
    const validation = validateManifest(content)

    if (!validation.valid) {
      throw new Error(
        `Invalid agent.yaml in ${dir.name}:\n  - ${validation.errors.join('\n  - ')}`,
      )
    }

    // Log warnings
    if (validation.warnings.length > 0) {
      console.warn(`  Warnings for ${dir.name}:`)
      for (const warning of validation.warnings) {
        console.warn(`    - ${warning}`)
      }
    }

    const manifest = validation.manifest!

    // Verify Dockerfile exists (unless using pre-built image)
    if (!manifest.image.imageUrl) {
      const dockerfilePath = manifest.image.dockerfile
        ? path.join(agentPath, manifest.image.dockerfile)
        : path.join(agentPath, 'Dockerfile')

      if (!fs.existsSync(dockerfilePath)) {
        throw new Error(`Dockerfile not found for ${dir.name}: ${dockerfilePath}`)
      }
    }

    agents.push({
      manifest,
      directoryPath: agentPath,
    })

    console.log(`  Found: ${manifest.metadata.name} (${manifest.metadata.slug})`)
  }

  console.log(`Discovered ${agents.length} built-in agents`)
  return agents
}

/**
 * Map a manifest to database fields for AgentType model.
 */
function mapManifestToDbFields(manifest: AgentManifest): Prisma.AgentTypeCreateInput {
  return {
    slug: manifest.metadata.slug,
    name: manifest.metadata.name,
    description: manifest.metadata.description,
    icon: manifest.metadata.icon || null,
    version: manifest.metadata.version,
    authorName: manifest.metadata.author?.name || null,
    authorEmail: manifest.metadata.author?.email || null,
    tags: manifest.metadata.tags || Prisma.JsonNull,
    capabilities: manifest.capabilities || [],
    dockerfilePath: manifest.image.dockerfile || 'Dockerfile',
    imageUrl: manifest.image.imageUrl || null,
    resourceMemory: manifest.resources?.memory?.limit || '512Mi',
    resourceCpu: manifest.resources?.cpu?.limit || '250m',
    resourceGpu: manifest.resources?.gpu || false,
    configSchema: manifest.configSchema ? (manifest.configSchema as Prisma.InputJsonValue) : Prisma.DbNull,
    defaultConfig: manifest.defaultConfig ? (manifest.defaultConfig as Prisma.InputJsonValue) : Prisma.JsonNull,
    sdkMinVersion: manifest.sdk?.minVersion || null,
  }
}

async function main() {
  console.log('Seeding agent types from manifests...')

  // Discover and validate all built-in agents
  const agents = discoverBuiltinAgents()

  if (agents.length === 0) {
    throw new Error('No built-in agents found. Check that agents/ directory contains agent subdirectories with agent.yaml files.')
  }

  // Upsert each agent to database
  for (const { manifest } of agents) {
    const dbFields = mapManifestToDbFields(manifest)

    const result = await prisma.agentType.upsert({
      where: { slug: manifest.metadata.slug },
      update: {
        name: dbFields.name,
        description: dbFields.description,
        icon: dbFields.icon,
        version: dbFields.version,
        authorName: dbFields.authorName,
        authorEmail: dbFields.authorEmail,
        tags: dbFields.tags,
        capabilities: dbFields.capabilities,
        dockerfilePath: dbFields.dockerfilePath,
        imageUrl: dbFields.imageUrl,
        resourceMemory: dbFields.resourceMemory,
        resourceCpu: dbFields.resourceCpu,
        resourceGpu: dbFields.resourceGpu,
        configSchema: dbFields.configSchema,
        defaultConfig: dbFields.defaultConfig,
        sdkMinVersion: dbFields.sdkMinVersion,
        // Preserve isBuiltIn and validationStatus on update
      },
      create: {
        ...dbFields,
        isBuiltIn: true,
        validationStatus: AgentValidationStatus.APPROVED,
      },
    })

    console.log(`  - ${result.name} (${result.slug}) [${result.id}]`)
  }

  console.log('Seeding complete!')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
