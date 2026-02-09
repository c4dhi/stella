-- AlterTable: Add isSystemAdmin to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: UsageMetricsSnapshot for hourly aggregated metrics
CREATE TABLE IF NOT EXISTS "UsageMetricsSnapshot" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSessions" INTEGER NOT NULL,
    "activeSessions" INTEGER NOT NULL,
    "totalAgents" INTEGER NOT NULL,
    "runningAgents" INTEGER NOT NULL,
    "failedAgents" INTEGER NOT NULL,
    "totalParticipants" INTEGER NOT NULL,
    "activeParticipants" INTEGER NOT NULL,
    "peakParticipants" INTEGER NOT NULL,
    "totalMessages" INTEGER NOT NULL,
    "messagesThisHour" INTEGER NOT NULL,

    CONSTRAINT "UsageMetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SessionActivityLog for session lifecycle tracking
CREATE TABLE IF NOT EXISTS "SessionActivityLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hasAgentError" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SessionActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ServerMetricsSnapshot for server performance metrics
CREATE TABLE IF NOT EXISTS "ServerMetricsSnapshot" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "cpuCores" INTEGER,
    "memoryTotal" BIGINT NOT NULL,
    "memoryUsed" BIGINT NOT NULL,
    "memoryFree" BIGINT NOT NULL,
    "gpuUsage" DOUBLE PRECISION,
    "gpuMemoryUsed" BIGINT,
    "gpuMemoryTotal" BIGINT,
    "gpuAvailable" BOOLEAN NOT NULL DEFAULT false,
    "k8sNodeCount" INTEGER,
    "k8sPodCount" INTEGER,
    "k8sCpuRequests" DOUBLE PRECISION,
    "k8sMemoryUsed" BIGINT,

    CONSTRAINT "ServerMetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UsageMetricsSnapshot_timestamp_idx" ON "UsageMetricsSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SessionActivityLog_createdAt_idx" ON "SessionActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SessionActivityLog_status_idx" ON "SessionActivityLog"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ServerMetricsSnapshot_timestamp_idx" ON "ServerMetricsSnapshot"("timestamp");
