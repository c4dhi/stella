/*
  Warnings:

  - You are about to drop the column `planId` on the `AgentInstance` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AgentInstance" DROP COLUMN "planId",
ADD COLUMN     "agentConfig" JSONB;

-- AlterTable
ALTER TABLE "AgentType" ADD COLUMN     "defaultConfig" JSONB;
