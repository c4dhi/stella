-- AlterTable
ALTER TABLE "AgentInstance" ADD COLUMN     "agentTypeId" TEXT;

-- CreateTable
CREATE TABLE "AgentType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "author" TEXT,
    "validationStatus" TEXT DEFAULT 'approved',
    "capabilities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentType_slug_key" ON "AgentType"("slug");

-- CreateIndex
CREATE INDEX "AgentType_slug_idx" ON "AgentType"("slug");

-- CreateIndex
CREATE INDEX "AgentType_isBuiltIn_idx" ON "AgentType"("isBuiltIn");

-- CreateIndex
CREATE INDEX "AgentInstance_agentTypeId_idx" ON "AgentInstance"("agentTypeId");

-- AddForeignKey
ALTER TABLE "AgentInstance" ADD CONSTRAINT "AgentInstance_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
