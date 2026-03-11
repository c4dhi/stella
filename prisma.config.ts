import { config as loadDotenv } from 'dotenv'
import { defineConfig } from 'prisma/config'

const envFilePath = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local'
loadDotenv({ path: envFilePath })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    // Provide fallback for build-time prisma generate (doesn't need real connection)
    url: process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
})
