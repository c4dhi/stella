-- AlterTable
ALTER TABLE "Project" ADD COLUMN "sessionInactivityEndMinutes" INTEGER;
ALTER TABLE "Project" ADD COLUMN "sessionMaxDurationMinutes" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "sessionInactivityEndMinutes" INTEGER;
ALTER TABLE "Session" ADD COLUMN "sessionMaxDurationMinutes" INTEGER;
