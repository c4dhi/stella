-- AlterTable
ALTER TABLE "AgentInstance" ADD COLUMN     "agentType" TEXT DEFAULT 'grace-agent',
ADD COLUMN     "grpcAddress" TEXT,
ADD COLUMN     "healthState" TEXT DEFAULT 'unknown',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastHealthCheck" TIMESTAMP(3),
ADD COLUMN     "messagesProcessed" INTEGER NOT NULL DEFAULT 0;
