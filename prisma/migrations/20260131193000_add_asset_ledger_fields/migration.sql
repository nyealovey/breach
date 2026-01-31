-- CreateTable
CREATE TABLE "AssetLedgerFields" (
    "assetUuid" UUID NOT NULL,
    "region" TEXT,
    "company" TEXT,
    "department" TEXT,
    "systemCategory" TEXT,
    "systemLevel" TEXT,
    "bizOwner" TEXT,
    "maintenanceDueDate" DATE,
    "purchaseDate" DATE,
    "bmcIp" TEXT,
    "cabinetNo" TEXT,
    "rackPosition" TEXT,
    "managementCode" TEXT,
    "fixedAssetNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetLedgerFields_pkey" PRIMARY KEY ("assetUuid")
);

-- CreateIndex
CREATE INDEX "AssetLedgerFields_company_idx" ON "AssetLedgerFields"("company");

-- CreateIndex
CREATE INDEX "AssetLedgerFields_department_idx" ON "AssetLedgerFields"("department");

-- CreateIndex
CREATE INDEX "AssetLedgerFields_systemCategory_idx" ON "AssetLedgerFields"("systemCategory");

-- CreateIndex
CREATE INDEX "AssetLedgerFields_systemLevel_idx" ON "AssetLedgerFields"("systemLevel");

-- AddForeignKey
ALTER TABLE "AssetLedgerFields" ADD CONSTRAINT "AssetLedgerFields_assetUuid_fkey" FOREIGN KEY ("assetUuid") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

