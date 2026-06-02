-- Ticket #251 + compiler versioning: manifest-driven runtime-variable palette and
-- prompt-compiler version tracking.

-- AgentType: declared {{placeholder}} palette + the prompt-compiler version the agent uses.
ALTER TABLE "AgentType" ADD COLUMN "runtimeVariables" JSONB;
ALTER TABLE "AgentType" ADD COLUMN "compilerVersion" TEXT;

-- AgentConfiguration: minimum compiler version this config's prompts require.
ALTER TABLE "AgentConfiguration" ADD COLUMN "minCompilerVersion" TEXT;
