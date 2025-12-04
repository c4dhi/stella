import { PrismaClient, AgentValidationStatus } from '@prisma/client'

const prisma = new PrismaClient()

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
  },
  {
    slug: 'grace-agent',
    name: 'Grace Agent',
    description: 'Full-featured conversational AI with expert consultation and plan execution.',
    icon: '👩‍⚕️',
    version: '1.0.0',
    isBuiltIn: true,
    validationStatus: AgentValidationStatus.APPROVED,
    capabilities: ['voice', 'text', 'plans', 'experts'],
    defaultConfig: { plan_id: 'grace_smalltalk' },  // Default plan for Grace agent
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
