-- CreateTable
CREATE TABLE "AssetHistoryEvent" (
    "id" TEXT NOT NULL,
    "assetUuid" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "refs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetHistoryEvent_assetUuid_occurredAt_idx" ON "AssetHistoryEvent"("assetUuid", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AssetHistoryEvent_eventType_occurredAt_idx" ON "AssetHistoryEvent"("eventType", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "AssetHistoryEvent" ADD CONSTRAINT "AssetHistoryEvent_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
