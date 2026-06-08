-- Retire stella-agent: repoint the AgentInstance.agentType column default to the
-- supported lightweight agent. New rows that omit agentType now default to
-- 'stella-light-agent' instead of the archived 'stella-agent'.
ALTER TABLE "AgentInstance" ALTER COLUMN "agentType" SET DEFAULT 'stella-light-agent';
