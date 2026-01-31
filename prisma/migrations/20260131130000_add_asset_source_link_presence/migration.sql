-- CreateEnum
CREATE TYPE "AssetPresenceStatus" AS ENUM ('present', 'missing');

-- AlterTable
ALTER TABLE "AssetSourceLink"
ADD COLUMN     "presenceStatus" "AssetPresenceStatus" NOT NULL DEFAULT 'present',
ADD COLUMN     "lastSeenRunId" TEXT;

-- CreateIndex
CREATE INDEX "AssetSourceLink_presenceStatus_lastSeenAt_idx" ON "AssetSourceLink"("presenceStatus", "lastSeenAt" DESC);

-- AddForeignKey
ALTER TABLE "AssetSourceLink" ADD CONSTRAINT "AssetSourceLink_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

