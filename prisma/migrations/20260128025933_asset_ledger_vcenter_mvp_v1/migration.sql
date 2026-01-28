-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('vcenter', 'pve', 'hyperv', 'aliyun', 'third_party');

-- CreateEnum
CREATE TYPE "RunTriggerType" AS ENUM ('schedule', 'manual');

-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('collect', 'detect', 'healthcheck');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('vm', 'host', 'cluster');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('in_service', 'offline', 'merged');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('runs_on', 'member_of');

-- CreateEnum
CREATE TYPE "RelationStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "ScheduleGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL,
    "runAtHhmm" TEXT NOT NULL,
    "maxParallelSources" INTEGER,
    "lastTriggeredOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleGroupId" TEXT,
    "config" JSONB,
    "credentialCiphertext" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scheduleGroupId" TEXT,
    "triggerType" "RunTriggerType" NOT NULL,
    "mode" "RunMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'Queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "detectResult" JSONB,
    "stats" JSONB,
    "warnings" JSONB,
    "errors" JSONB,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'admin',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "uuid" UUID NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "displayName" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'in_service',
    "mergedIntoAssetUuid" UUID,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("uuid")
);

-- CreateTable
CREATE TABLE "AssetSourceLink" (
    "id" TEXT NOT NULL,
    "assetUuid" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalKind" "AssetType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "assetUuid" UUID NOT NULL,
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

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id","collectedAt")
) PARTITION BY RANGE ("collectedAt");

-- CreateTable
CREATE TABLE "RelationRecord" (
    "id" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relationId" TEXT,
    "relationType" "RelationType" NOT NULL,
    "fromAssetUuid" UUID NOT NULL,
    "toAssetUuid" UUID NOT NULL,
    "raw" BYTEA NOT NULL,
    "rawCompression" TEXT NOT NULL,
    "rawSizeBytes" INTEGER NOT NULL,
    "rawHash" TEXT NOT NULL,
    "rawMimeType" TEXT,
    "rawInlineExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationRecord_pkey" PRIMARY KEY ("id","collectedAt")
) PARTITION BY RANGE ("collectedAt");

-- Create monthly partitions for high-growth tables (MVP: current + next month)
CREATE TABLE "source_record_202601" PARTITION OF "SourceRecord" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "source_record_202602" PARTITION OF "SourceRecord" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE "relation_record_202601" PARTITION OF "RelationRecord" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "relation_record_202602" PARTITION OF "RelationRecord" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- CreateTable
CREATE TABLE "Relation" (
    "id" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "fromAssetUuid" UUID NOT NULL,
    "toAssetUuid" UUID NOT NULL,
    "sourceId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RelationStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "Relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRunSnapshot" (
    "id" TEXT NOT NULL,
    "assetUuid" UUID NOT NULL,
    "runId" TEXT NOT NULL,
    "canonical" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRunSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleGroup_name_key" ON "ScheduleGroup"("name");

-- CreateIndex
CREATE INDEX "ScheduleGroup_enabled_idx" ON "ScheduleGroup"("enabled");

-- CreateIndex
CREATE INDEX "Source_enabled_idx" ON "Source"("enabled");

-- CreateIndex
CREATE INDEX "Source_scheduleGroupId_idx" ON "Source"("scheduleGroupId");

-- CreateIndex
CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_sourceId_status_createdAt_idx" ON "Run"("sourceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_scheduleGroupId_status_createdAt_idx" ON "Run"("scheduleGroupId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_assetType_idx" ON "Asset"("assetType");

-- CreateIndex
CREATE INDEX "Asset_status_idx" ON "Asset"("status");

-- CreateIndex
CREATE INDEX "Asset_lastSeenAt_idx" ON "Asset"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AssetSourceLink_assetUuid_idx" ON "AssetSourceLink"("assetUuid");

-- CreateIndex
CREATE INDEX "AssetSourceLink_sourceId_idx" ON "AssetSourceLink"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetSourceLink_sourceId_externalKind_externalId_key" ON "AssetSourceLink"("sourceId", "externalKind", "externalId");

-- CreateIndex
CREATE INDEX "SourceRecord_runId_idx" ON "SourceRecord"("runId");

-- CreateIndex
CREATE INDEX "SourceRecord_linkId_idx" ON "SourceRecord"("linkId");

-- CreateIndex
CREATE INDEX "SourceRecord_assetUuid_collectedAt_idx" ON "SourceRecord"("assetUuid", "collectedAt" DESC);

-- CreateIndex
CREATE INDEX "SourceRecord_sourceId_collectedAt_idx" ON "SourceRecord"("sourceId", "collectedAt" DESC);

-- CreateIndex
CREATE INDEX "RelationRecord_runId_idx" ON "RelationRecord"("runId");

-- CreateIndex
CREATE INDEX "RelationRecord_sourceId_idx" ON "RelationRecord"("sourceId");

-- CreateIndex
CREATE INDEX "RelationRecord_relationType_fromAssetUuid_toAssetUuid_idx" ON "RelationRecord"("relationType", "fromAssetUuid", "toAssetUuid");

-- CreateIndex
CREATE INDEX "RelationRecord_collectedAt_idx" ON "RelationRecord"("collectedAt");

-- CreateIndex
CREATE INDEX "Relation_sourceId_idx" ON "Relation"("sourceId");

-- CreateIndex
CREATE INDEX "Relation_relationType_fromAssetUuid_idx" ON "Relation"("relationType", "fromAssetUuid");

-- CreateIndex
CREATE INDEX "Relation_relationType_toAssetUuid_idx" ON "Relation"("relationType", "toAssetUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Relation_relationType_fromAssetUuid_toAssetUuid_sourceId_key" ON "Relation"("relationType", "fromAssetUuid", "toAssetUuid", "sourceId");

-- CreateIndex
CREATE INDEX "AssetRunSnapshot_runId_idx" ON "AssetRunSnapshot"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRunSnapshot_assetUuid_runId_key" ON "AssetRunSnapshot"("assetUuid", "runId");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_scheduleGroupId_fkey" FOREIGN KEY ("scheduleGroupId") REFERENCES "ScheduleGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_scheduleGroupId_fkey" FOREIGN KEY ("scheduleGroupId") REFERENCES "ScheduleGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_mergedIntoAssetUuid_fkey" FOREIGN KEY ("mergedIntoAssetUuid") REFERENCES "Asset"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSourceLink" ADD CONSTRAINT "AssetSourceLink_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetSourceLink" ADD CONSTRAINT "AssetSourceLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "AssetSourceLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationRecord" ADD CONSTRAINT "RelationRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationRecord" ADD CONSTRAINT "RelationRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationRecord" ADD CONSTRAINT "RelationRecord_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_fromAssetUuid_fkey" FOREIGN KEY ("fromAssetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_toAssetUuid_fkey" FOREIGN KEY ("toAssetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRunSnapshot" ADD CONSTRAINT "AssetRunSnapshot_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRunSnapshot" ADD CONSTRAINT "AssetRunSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
