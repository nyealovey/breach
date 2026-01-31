-- CreateEnum
CREATE TYPE "AssetLedgerExportStatus" AS ENUM ('Queued', 'Running', 'Succeeded', 'Failed', 'Expired');

-- CreateTable
CREATE TABLE "AssetLedgerExport" (
    "id" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" "AssetLedgerExportStatus" NOT NULL DEFAULT 'Queued',
    "requestId" TEXT,
    "params" JSONB NOT NULL,
    "rowCount" INTEGER,
    "fileName" TEXT,
    "fileSizeBytes" INTEGER,
    "fileSha256" TEXT,
    "fileBytes" BYTEA,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AssetLedgerExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetLedgerExport_status_createdAt_idx" ON "AssetLedgerExport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AssetLedgerExport_requestedByUserId_createdAt_idx" ON "AssetLedgerExport"("requestedByUserId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "AssetLedgerExport" ADD CONSTRAINT "AssetLedgerExport_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

