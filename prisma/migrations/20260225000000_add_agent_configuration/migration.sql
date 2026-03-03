-- AlterTable
ALTER TABLE "AgentType" ADD COLUMN "pipelineSchema" JSONB;

-- CreateTable
CREATE TABLE "AgentConfiguration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "agentTypeId" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "agentVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConfiguration_userId_idx" ON "AgentConfiguration"("userId");

-- CreateIndex
CREATE INDEX "AgentConfiguration_agentTypeId_idx" ON "AgentConfiguration"("agentTypeId");

-- CreateIndex
CREATE INDEX "AgentConfiguration_userId_agentTypeId_idx" ON "AgentConfiguration"("userId", "agentTypeId");

-- AddForeignKey
ALTER TABLE "AgentConfiguration" ADD CONSTRAINT "AgentConfiguration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfiguration" ADD CONSTRAINT "AgentConfiguration_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
