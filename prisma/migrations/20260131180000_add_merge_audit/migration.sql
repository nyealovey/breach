-- CreateEnum
CREATE TYPE "MergeConflictStrategy" AS ENUM ('primary_wins', 'latest_wins', 'manual_pick');

-- CreateTable
CREATE TABLE "MergeAudit" (
    "id" TEXT NOT NULL,
    "primaryAssetUuid" UUID NOT NULL,
    "mergedAssetUuid" UUID NOT NULL,
    "performedByUserId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conflictStrategy" "MergeConflictStrategy" NOT NULL DEFAULT 'primary_wins',
    "summary" JSONB NOT NULL,
    "snapshotRef" TEXT,

    CONSTRAINT "MergeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MergeAudit_primaryAssetUuid_performedAt_idx" ON "MergeAudit"("primaryAssetUuid", "performedAt" DESC);

-- CreateIndex
CREATE INDEX "MergeAudit_mergedAssetUuid_performedAt_idx" ON "MergeAudit"("mergedAssetUuid", "performedAt" DESC);

-- CreateIndex
CREATE INDEX "MergeAudit_performedByUserId_performedAt_idx" ON "MergeAudit"("performedByUserId", "performedAt" DESC);

-- AddForeignKey
ALTER TABLE "MergeAudit" ADD CONSTRAINT "MergeAudit_primaryAssetUuid_fkey" FOREIGN KEY ("primaryAssetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeAudit" ADD CONSTRAINT "MergeAudit_mergedAssetUuid_fkey" FOREIGN KEY ("mergedAssetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MergeAudit" ADD CONSTRAINT "MergeAudit_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

