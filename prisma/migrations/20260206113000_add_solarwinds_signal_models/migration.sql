-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'solarwinds';

-- CreateEnum
CREATE TYPE "SourceRole" AS ENUM ('inventory', 'signal');

-- CreateEnum
CREATE TYPE "SignalMatchType" AS ENUM ('auto', 'manual');

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "role" "SourceRole" NOT NULL DEFAULT 'inventory';

-- CreateTable
CREATE TABLE "AssetOperationalState" (
    "assetUuid" UUID NOT NULL,
    "backupCovered" BOOLEAN,
    "backupState" TEXT,
    "backupLastSuccessAt" TIMESTAMP(3),
    "backupLastResult" TEXT,
    "backupUpdatedAt" TIMESTAMP(3),
    "monitorCovered" BOOLEAN,
    "monitorState" TEXT,
    "monitorStatus" TEXT,
    "monitorUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetOperationalState_pkey" PRIMARY KEY ("assetUuid")
);

-- CreateTable
CREATE TABLE "AssetSignalLink" (
    "id" TEXT NOT NULL,
    "assetUuid" UUID,
    "sourceId" TEXT NOT NULL,
    "externalKind" "AssetType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenRunId" TEXT,
    "matchType" "SignalMatchType",
    "matchConfidence" INTEGER,
    "matchReason" TEXT,
    "matchEvidence" JSONB,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "ambiguousCandidates" JSONB,

    CONSTRAINT "AssetSignalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalRecord" (
    "id" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "assetUuid" UUID,
    "externalKind" "AssetType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "normalized" JSONB NOT NULL,
    "raw" BYTEA NOT NULL,
    "rawCompression" TEXT NOT NULL,
    "rawSizeBytes" INTEGER NOT NULL,
    "rawHash" TEXT NOT NULL,
    "rawMimeType" TEXT,
    "rawInlineExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalRecord_pkey" PRIMARY KEY ("id","collectedAt")
) PARTITION BY RANGE ("collectedAt");

-- Create monthly partitions for high-growth tables (MVP: current + next month)
CREATE TABLE "signal_record_202602" PARTITION OF "SignalRecord" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE "signal_record_202603" PARTITION OF "SignalRecord" FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE "signal_record_default" PARTITION OF "SignalRecord" DEFAULT;

-- CreateIndex
CREATE INDEX "AssetOperationalState_backupCovered_idx" ON "AssetOperationalState"("backupCovered");

-- CreateIndex
CREATE INDEX "AssetOperationalState_monitorCovered_idx" ON "AssetOperationalState"("monitorCovered");

-- CreateIndex
CREATE INDEX "AssetOperationalState_backupUpdatedAt_idx" ON "AssetOperationalState"("backupUpdatedAt");

-- CreateIndex
CREATE INDEX "AssetOperationalState_monitorUpdatedAt_idx" ON "AssetOperationalState"("monitorUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetSignalLink_sourceId_externalKind_externalId_key" ON "AssetSignalLink"("sourceId", "externalKind", "externalId");

-- CreateIndex
CREATE INDEX "AssetSignalLink_assetUuid_idx" ON "AssetSignalLink"("assetUuid");

-- CreateIndex
CREATE INDEX "AssetSignalLink_sourceId_idx" ON "AssetSignalLink"("sourceId");

-- CreateIndex
CREATE INDEX "AssetSignalLink_lastSeenAt_idx" ON "AssetSignalLink"("lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "SignalRecord_runId_idx" ON "SignalRecord"("runId");

-- CreateIndex
CREATE INDEX "SignalRecord_linkId_idx" ON "SignalRecord"("linkId");

-- CreateIndex
CREATE INDEX "SignalRecord_assetUuid_collectedAt_idx" ON "SignalRecord"("assetUuid", "collectedAt" DESC);

-- CreateIndex
CREATE INDEX "SignalRecord_sourceId_collectedAt_idx" ON "SignalRecord"("sourceId", "collectedAt" DESC);

-- AddForeignKey
ALTER TABLE "AssetOperationalState" ADD CONSTRAINT "AssetOperationalState_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSignalLink" ADD CONSTRAINT "AssetSignalLink_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSignalLink" ADD CONSTRAINT "AssetSignalLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSignalLink" ADD CONSTRAINT "AssetSignalLink_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AssetSignalLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalRecord" ADD CONSTRAINT "SignalRecord_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;
