import { PrismaClient, AgentValidationStatus, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

// Config schema for agents that require a plan
const planRequiredSchema: Prisma.InputJsonValue = {
  type: 'object',
  properties: {
    plan: {
      type: 'object',
      description: 'Plan configuration with states, tasks, and deliverables',
      'x-stella-requires-plan': true,  // Marker for DeployAgentModal to show plan selection step
    },
    llm: {
      type: 'object',
      description: 'LLM configuration (model, temperature, etc.)',
      properties: {
        model: { type: 'string', default: 'gpt-4o' },
        temperature: { type: 'number', default: 0.7 },
      },
    },
  },
  // Required environment variables that must be provided via template or manual entry
  'x-stella-env-vars': ['OPENAI_API_KEY'],
}

const builtInAgents = [
  {
    slug: 'echo-agent',
    name: 'Echo Agent',
    description: 'Simple test agent that echoes user input back. Great for testing audio pipelines.',
    icon: '🔊',
    version: '1.0.0',
    isBuiltIn: true,
    validationStatus: AgentValidationStatus.APPROVED,
    capabilities: ['voice', 'text'],
    defaultConfig: {},  // Echo agent has no special config
    configSchema: Prisma.DbNull,  // No special requirements
  },
  {
    slug: 'stella-agent',
    name: 'Stella Agent',
    description: 'Full-featured conversational AI with expert consultation and plan execution.',
    icon: '👩‍⚕️',
    version: '1.0.0',
    isBuiltIn: true,
    validationStatus: AgentValidationStatus.APPROVED,
    capabilities: ['voice', 'text', 'plans', 'experts'],
    defaultConfig: {},  // Plan is now passed via config.plan instead of plan_id
    configSchema: planRequiredSchema,  // Requires a plan to be selected
  },
  {
    slug: 'stella-light-agent',
    name: 'Stella Light',
    description: 'Lightweight conversational AI with prompt-based guardrails. Faster responses, lower cost.',
    icon: '💡',
    version: '1.0.0',
    isBuiltIn: true,
    validationStatus: AgentValidationStatus.APPROVED,
    capabilities: ['voice', 'text', 'plans'],
    defaultConfig: {},  // Plan is now passed via config.plan instead of plan_id
    configSchema: planRequiredSchema,  // Requires a plan to be selected
  },
]

async function main() {
  console.log('Seeding agent types...')

  for (const agent of builtInAgents) {
    const result = await prisma.agentType.upsert({
      where: { slug: agent.slug },
      update: {
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        version: agent.version,
        isBuiltIn: agent.isBuiltIn,
        validationStatus: agent.validationStatus,
        capabilities: agent.capabilities,
        defaultConfig: agent.defaultConfig,
        configSchema: agent.configSchema,
      },
      create: agent,
    })
    console.log(`  - ${result.name} (${result.slug})`)
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
