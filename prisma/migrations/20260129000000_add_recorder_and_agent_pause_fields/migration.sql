-- Message-recorder optimization: webhook-driven room management
-- Adds fields to Session model for tracking human presence and recorder join state

ALTER TABLE "Session" ADD COLUMN "hasHumanParticipant" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "humanJoinedAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "humanLeftAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "recorderShouldJoin" BOOLEAN NOT NULL DEFAULT false;

-- Agent pausing: on-demand spawning for resource optimization
ALTER TABLE "Session" ADD COLUMN "agentSpawnMode" TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE "Session" ADD COLUMN "lastAgentConfig" JSONB;

-- Add fields to AgentInstance for pause tracking
ALTER TABLE "AgentInstance" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "AgentInstance" ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "AgentInstance" ADD COLUMN "resumeCount" INTEGER NOT NULL DEFAULT 0;

-- Index for efficient room-to-join queries
CREATE INDEX "Session_recorderShouldJoin_idx" ON "Session"("recorderShouldJoin");
