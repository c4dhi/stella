-- AlterTable
ALTER TABLE "Project" ADD COLUMN "publicMaxSessionDurationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN "maxSessionDurationSeconds" INTEGER;
