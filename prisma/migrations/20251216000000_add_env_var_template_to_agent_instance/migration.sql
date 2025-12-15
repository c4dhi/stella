-- AlterTable
ALTER TABLE "AgentInstance" ADD COLUMN     "envVarTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "AgentInstance_envVarTemplateId_idx" ON "AgentInstance"("envVarTemplateId");

-- AddForeignKey
ALTER TABLE "AgentInstance" ADD CONSTRAINT "AgentInstance_envVarTemplateId_fkey" FOREIGN KEY ("envVarTemplateId") REFERENCES "EnvVarTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
