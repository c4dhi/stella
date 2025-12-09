-- CreateTable
CREATE TABLE "EnvVarTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "variables" TEXT NOT NULL,
    "agentTypeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvVarTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvVarTemplate_userId_idx" ON "EnvVarTemplate"("userId");

-- CreateIndex
CREATE INDEX "EnvVarTemplate_agentTypeId_idx" ON "EnvVarTemplate"("agentTypeId");

-- AddForeignKey
ALTER TABLE "EnvVarTemplate" ADD CONSTRAINT "EnvVarTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvVarTemplate" ADD CONSTRAINT "EnvVarTemplate_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
