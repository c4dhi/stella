import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { parseAgentManifestYaml, type CanonicalAgentManifest } from '../src/agent-package/schemas/agent-manifest.schema'

function resolveWorkspaceRoot(): string {
  if (process.env.AGENT_WORKSPACE_ROOT) {
    return process.env.AGENT_WORKSPACE_ROOT
  }

  // Support both compile layouts:
  // - prisma/seed.js            -> __dirname ends with /prisma
  // - prisma/prisma/seed.js     -> __dirname ends with /prisma/prisma
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'agents'))) {
      return candidate
    }
  }

  // Fall back to previous behavior for consistent error messaging downstream.
  return path.resolve(__dirname, '..')
}

function loadSeedEnv(): void {
  const workspaceRoot = resolveWorkspaceRoot()
  const envPath = path.join(workspaceRoot, '.env')
  const envLocalPath = path.join(workspaceRoot, '.env.local')

  // Load .env first, then .env.local to allow local overrides.
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath, override: true })
  }
}

loadSeedEnv()

const prisma = new PrismaClient()

// Directories to skip when scanning for agents
const SKIP_DIRS = ['stella-ai-agent-sdk']

type AgentManifest = CanonicalAgentManifest

interface BuiltinAgentInfo {
  manifest: AgentManifest
  directoryPath: string
}

/**
 * Discover built-in agents from the agents/ directory.
 *
 * Path resolution:
 * - In K8s: Uses AGENT_WORKSPACE_ROOT env var (mounted project directory)
 * - Local dev: Uses relative path from prisma/ to agents/
 */
function discoverBuiltinAgents(): BuiltinAgentInfo[] {
  const workspaceRoot = resolveWorkspaceRoot()
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

    // Seed uses the same parser as package upload/runtime validation to avoid drift.
    const content = fs.readFileSync(manifestPath, 'utf-8')
    const validation = parseAgentManifestYaml(content)

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
    // Preserve null semantics expected by existing DB readers.
    configSchema: manifest.configSchema ? (manifest.configSchema as Prisma.InputJsonValue) : Prisma.DbNull,
    defaultConfig: manifest.defaultConfig ? (manifest.defaultConfig as Prisma.InputJsonValue) : Prisma.JsonNull,
    pipelineSchema: manifest.pipelineSchema ? (manifest.pipelineSchema as Prisma.InputJsonValue) : Prisma.DbNull,
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
        pipelineSchema: dbFields.pipelineSchema,
        sdkMinVersion: dbFields.sdkMinVersion,
        // Preserve isBuiltIn and validationStatus on update
      },
      create: {
        ...dbFields,
        isBuiltIn: true,
        // Use literal to avoid hard dependency on generated enum export names.
        validationStatus: 'APPROVED',
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
