/*
  Custom Agent Upload System Migration

  This migration adds support for users to upload custom agent packages.
  Changes:
  - Creates AgentValidationStatus enum
  - Extends AgentType with ownership, package storage, and build config fields
  - Creates AgentBuildLog table for tracking image builds
  - Adds relationship between User and AgentType for ownership
*/

-- CreateEnum
CREATE TYPE "AgentValidationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: Add new columns to AgentType
ALTER TABLE "AgentType"
ADD COLUMN "userId" TEXT,
ADD COLUMN "packagePath" TEXT,
ADD COLUMN "packageSize" INTEGER,
ADD COLUMN "packageHash" TEXT,
ADD COLUMN "dockerfilePath" TEXT,
ADD COLUMN "validationNotes" TEXT,
ADD COLUMN "validatedAt" TIMESTAMP(3),
ADD COLUMN "validatedBy" TEXT,
ADD COLUMN "configSchema" JSONB,
ADD COLUMN "resourceMemory" TEXT DEFAULT '512Mi',
ADD COLUMN "resourceCpu" TEXT DEFAULT '250m',
ADD COLUMN "resourceGpu" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "authorName" TEXT,
ADD COLUMN "authorEmail" TEXT,
ADD COLUMN "tags" JSONB,
ADD COLUMN "sdkMinVersion" TEXT;

-- Convert validationStatus from TEXT to ENUM
-- First, create a temporary column
ALTER TABLE "AgentType" ADD COLUMN "validationStatus_new" "AgentValidationStatus" DEFAULT 'PENDING';

-- Copy data with transformation
UPDATE "AgentType" SET "validationStatus_new" =
  CASE
    WHEN "validationStatus" = 'approved' THEN 'APPROVED'::"AgentValidationStatus"
    WHEN "validationStatus" = 'rejected' THEN 'REJECTED'::"AgentValidationStatus"
    ELSE 'PENDING'::"AgentValidationStatus"
  END;

-- Drop old column and rename new one
ALTER TABLE "AgentType" DROP COLUMN "validationStatus";
ALTER TABLE "AgentType" RENAME COLUMN "validationStatus_new" TO "validationStatus";

-- Set the default
ALTER TABLE "AgentType" ALTER COLUMN "validationStatus" SET DEFAULT 'PENDING'::"AgentValidationStatus";

-- CreateTable: AgentBuildLog
CREATE TABLE "AgentBuildLog" (
    "id" TEXT NOT NULL,
    "agentTypeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imageName" TEXT,
    "buildOutput" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentBuildLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentType_userId_idx" ON "AgentType"("userId");

-- CreateIndex
CREATE INDEX "AgentType_validationStatus_idx" ON "AgentType"("validationStatus");

-- CreateIndex
CREATE INDEX "AgentBuildLog_agentTypeId_idx" ON "AgentBuildLog"("agentTypeId");

-- CreateIndex
CREATE INDEX "AgentBuildLog_status_idx" ON "AgentBuildLog"("status");

-- CreateIndex
CREATE INDEX "AgentBuildLog_startedAt_idx" ON "AgentBuildLog"("startedAt");

-- AddForeignKey
ALTER TABLE "AgentType" ADD CONSTRAINT "AgentType_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentBuildLog" ADD CONSTRAINT "AgentBuildLog_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
