-- Agent-declared default experts published to the Configurator.
-- Parsed from each agent package's config/experts/*.json (gated on the "experts"
-- capability) so the frontend Expert Module renders the agent's declared
-- experts/verdicts/actions instead of hardcoding them.
ALTER TABLE "AgentType" ADD COLUMN "expertDefaults" JSONB;
