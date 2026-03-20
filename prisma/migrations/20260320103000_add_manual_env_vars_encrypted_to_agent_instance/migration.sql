-- Persist manually entered environment variables (encrypted) so they can be reused on agent restart.
ALTER TABLE "AgentInstance"
ADD COLUMN "manualEnvVarsEncrypted" TEXT;
