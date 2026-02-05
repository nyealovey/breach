-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "collectedHostname" TEXT,
ADD COLUMN     "collectedIpText" TEXT,
ADD COLUMN     "collectedVmCaption" TEXT,
ADD COLUMN     "machineNameVmNameMismatch" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Asset_assetType_machineNameVmNameMismatch_idx" ON "Asset"("assetType", "machineNameVmNameMismatch");
