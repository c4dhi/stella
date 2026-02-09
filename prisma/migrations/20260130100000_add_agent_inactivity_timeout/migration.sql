-- AlterTable
ALTER TABLE "Project" ADD COLUMN "agentInactivityTimeoutMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "agentInactivityTimeoutMinutes" INTEGER;
