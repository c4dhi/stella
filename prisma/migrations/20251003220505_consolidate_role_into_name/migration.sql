-- Consolidate 'role' into 'name' field for AgentInstance
-- Step 1: Copy role values to name where name is NULL
UPDATE "AgentInstance" SET "name" = "role" WHERE "name" IS NULL;

-- Step 2: Make name NOT NULL
ALTER TABLE "AgentInstance" ALTER COLUMN "name" SET NOT NULL;

-- Step 3: Drop the index on [sessionId, role]
DROP INDEX "AgentInstance_sessionId_role_idx";

-- Step 4: Drop the role column
ALTER TABLE "AgentInstance" DROP COLUMN "role";
