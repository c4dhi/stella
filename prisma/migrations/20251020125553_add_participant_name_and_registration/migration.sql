/*
  Warnings:

  - Added the required column `name` to the `Participant` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "isManuallyRegistered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Message_sessionId_timestamp_idx" ON "Message"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_messageType_idx" ON "Message"("messageType");
