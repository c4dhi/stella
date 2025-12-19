-- CreateTable
CREATE TABLE "SessionState" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "planId" TEXT,
    "planData" JSONB NOT NULL,
    "currentStateId" TEXT NOT NULL,
    "completedTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skippedTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliverables" JSONB NOT NULL DEFAULT '{}',
    "turnsWithoutProgress" INTEGER NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastTransitionAt" TIMESTAMP(3),

    CONSTRAINT "SessionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionState_sessionId_key" ON "SessionState"("sessionId");

-- CreateIndex
CREATE INDEX "SessionState_sessionId_idx" ON "SessionState"("sessionId");

-- CreateIndex
CREATE INDEX "SessionState_planId_idx" ON "SessionState"("planId");

-- AddForeignKey
ALTER TABLE "SessionState" ADD CONSTRAINT "SessionState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
