-- Ticket #240 (extended): scope env-var templates to a single AgentType (required),
-- and add AgentConfiguration reconciliation state + AgentType pipeline-schema hash.

-- CreateEnum
CREATE TYPE "ConfigCompatibility" AS ENUM ('CURRENT', 'COMPATIBLE', 'OUTDATED');

-- AlterTable: AgentType gains a pipelineSchema hash so the seed can detect schema edits.
ALTER TABLE "AgentType" ADD COLUMN "pipelineSchemaHash" TEXT;

-- AlterTable: AgentConfiguration gains reconciliation state.
ALTER TABLE "AgentConfiguration" ADD COLUMN "compatibility" "ConfigCompatibility" NOT NULL DEFAULT 'CURRENT';
ALTER TABLE "AgentConfiguration" ADD COLUMN "compatibilityNote" TEXT;
ALTER TABLE "AgentConfiguration" ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AgentConfiguration_agentTypeId_compatibility_idx" ON "AgentConfiguration"("agentTypeId", "compatibility");

-- ============================================================================
-- Backfill EnvVarTemplate.agentTypeId before enforcing NOT NULL.
-- AgentInstance has no userId and stores the type as a slug (agentTypeId FK is
-- rarely populated), so the owner's most-recently-used type is derived via:
--   userId -> ProjectMembership -> Session -> AgentInstance
--   and the type resolved via COALESCE(ai.agentTypeId, AgentType matched by slug).
-- ============================================================================

-- 0) Snapshot the templates that need backfilling so we can report the resolved
--    bindings below. The backfill heuristic (most-recently-used type) can mis-scope
--    a template authored for a different type, which then 400s at spawn — so make
--    the silent re-binding auditable in the migration log.
CREATE TEMP TABLE _envtpl_backfill_targets AS
  SELECT id FROM "EnvVarTemplate" WHERE "agentTypeId" IS NULL;

-- 1) Most-recently-used AgentType per owning user.
UPDATE "EnvVarTemplate" AS et
SET "agentTypeId" = ranked.resolved_type_id
FROM (
  SELECT DISTINCT ON (et2.id)
         et2.id AS template_id,
         COALESCE(ai."agentTypeId", at_slug.id) AS resolved_type_id
  FROM "EnvVarTemplate" et2
  JOIN "ProjectMembership" pm ON pm."userId" = et2."userId"
  JOIN "Session" s            ON s."projectId" = pm."projectId"
  JOIN "AgentInstance" ai     ON ai."sessionId" = s.id
  LEFT JOIN "AgentType" at_slug ON at_slug."slug" = ai."agentType"
  WHERE et2."agentTypeId" IS NULL
    AND COALESCE(ai."agentTypeId", at_slug.id) IS NOT NULL
  ORDER BY et2.id, ai."createdAt" DESC, ai."id" DESC
) AS ranked
WHERE et.id = ranked.template_id
  AND et."agentTypeId" IS NULL;

-- 2) Fallback: remaining NULLs -> the 'stella-v2-agent' AgentType (if present).
UPDATE "EnvVarTemplate" et
SET "agentTypeId" = f.id
FROM (SELECT id FROM "AgentType" WHERE "slug" = 'stella-v2-agent' LIMIT 1) AS f
WHERE et."agentTypeId" IS NULL;

-- 2b) Report every backfilled binding so an operator can spot a mis-scoped template
--     (one re-bound to a type it wasn't authored for) instead of discovering it as a
--     spawn-time 400. Temp tables are dropped automatically at end of session.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT et.id AS template_id, et."name" AS template_name, at."slug" AS type_slug
    FROM "EnvVarTemplate" et
    JOIN _envtpl_backfill_targets t ON t.id = et.id
    LEFT JOIN "AgentType" at ON at.id = et."agentTypeId"
  LOOP
    RAISE NOTICE 'Migration #240 backfill: EnvVarTemplate % (%) -> AgentType %',
      r.template_id, r.template_name, COALESCE(r.type_slug, '(UNRESOLVED)');
  END LOOP;
END $$;

-- 3) Guard: abort (rolls back the whole migration) if any NULL remains; never drop rows.
--    NOTE: this is a HARD STOP for the deploy — on a database whose AgentTypes are not
--    yet seeded (or were renamed) and that has templates with no resolvable agent
--    history, the init-container `prisma migrate deploy` fails and the whole rollout
--    halts. Seed/create the stella-v2-agent AgentType (or assign the listed templates
--    manually) before retrying.
DO $$
DECLARE
  remaining BIGINT;
BEGIN
  SELECT count(*) INTO remaining FROM "EnvVarTemplate" WHERE "agentTypeId" IS NULL;
  IF remaining > 0 THEN
    RAISE EXCEPTION
      'Migration #240 aborted: % EnvVarTemplate row(s) still have NULL agentTypeId (no resolvable agent history and no AgentType with slug ''stella-v2-agent'' to fall back to). No rows were dropped; seed/create stella-v2-agent or assign these templates manually, then re-run.',
      remaining;
  END IF;
END $$;

-- Enforce NOT NULL. The original FK used ON DELETE SET NULL which is incompatible
-- with a NOT NULL column, so drop and recreate it as ON DELETE RESTRICT.
ALTER TABLE "EnvVarTemplate" DROP CONSTRAINT "EnvVarTemplate_agentTypeId_fkey";
ALTER TABLE "EnvVarTemplate" ALTER COLUMN "agentTypeId" SET NOT NULL;
ALTER TABLE "EnvVarTemplate" ADD CONSTRAINT "EnvVarTemplate_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
