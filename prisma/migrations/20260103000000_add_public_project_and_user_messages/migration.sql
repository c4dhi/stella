-- CreateEnum
CREATE TYPE "UserMessageType" AS ENUM ('PROJECT_INVITATION');

-- CreateEnum
CREATE TYPE "ProjectInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicAgentConfig" JSONB,
ADD COLUMN     "publicAgentTypeId" TEXT,
ADD COLUMN     "publicEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "publicExpiresAt" TIMESTAMP(3),
ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "publicVisualizerLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicVisualizerType" TEXT;

-- CreateTable
CREATE TABLE "UserMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserMessageType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relatedEntityId" TEXT,
    "relatedEntityType" TEXT,

    CONSTRAINT "UserMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "ProjectInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMessage_userId_idx" ON "UserMessage"("userId");

-- CreateIndex
CREATE INDEX "UserMessage_userId_read_idx" ON "UserMessage"("userId", "read");

-- CreateIndex
CREATE INDEX "UserMessage_createdAt_idx" ON "UserMessage"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectInvitation_inviteeId_status_idx" ON "ProjectInvitation"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_idx" ON "ProjectInvitation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_projectId_inviteeId_key" ON "ProjectInvitation"("projectId", "inviteeId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_publicToken_key" ON "Project"("publicToken");

-- CreateIndex
CREATE INDEX "Project_publicToken_idx" ON "Project"("publicToken");

-- CreateIndex
CREATE INDEX "Project_isPublic_publicEnabled_idx" ON "Project"("isPublic", "publicEnabled");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_publicAgentTypeId_fkey" FOREIGN KEY ("publicAgentTypeId") REFERENCES "AgentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMessage" ADD CONSTRAINT "UserMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
