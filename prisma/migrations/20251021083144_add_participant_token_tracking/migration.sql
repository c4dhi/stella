-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "lastTokenRefresh" TIMESTAMP(3),
ADD COLUMN     "tokenRevokedAt" TIMESTAMP(3);
