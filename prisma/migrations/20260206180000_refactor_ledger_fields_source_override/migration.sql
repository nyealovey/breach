-- Drop legacy single-value indexes (will be replaced by source/override indexes)
DROP INDEX IF EXISTS "AssetLedgerFields_company_idx";
DROP INDEX IF EXISTS "AssetLedgerFields_department_idx";
DROP INDEX IF EXISTS "AssetLedgerFields_systemCategory_idx";
DROP INDEX IF EXISTS "AssetLedgerFields_systemLevel_idx";

-- Rename legacy columns to override columns to preserve historical manual values
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "region" TO "regionOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "company" TO "companyOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "department" TO "departmentOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "systemCategory" TO "systemCategoryOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "systemLevel" TO "systemLevelOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "bizOwner" TO "bizOwnerOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "maintenanceDueDate" TO "maintenanceDueDateOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "purchaseDate" TO "purchaseDateOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "bmcIp" TO "bmcIpOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "cabinetNo" TO "cabinetNoOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "rackPosition" TO "rackPositionOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "managementCode" TO "managementCodeOverride";
ALTER TABLE "AssetLedgerFields"
  RENAME COLUMN "fixedAssetNo" TO "fixedAssetNoOverride";

-- Add source columns (nullable; populated by SolarWinds manual sync)
ALTER TABLE "AssetLedgerFields"
  ADD COLUMN "regionSource" TEXT,
  ADD COLUMN "companySource" TEXT,
  ADD COLUMN "departmentSource" TEXT,
  ADD COLUMN "systemCategorySource" TEXT,
  ADD COLUMN "systemLevelSource" TEXT,
  ADD COLUMN "bizOwnerSource" TEXT,
  ADD COLUMN "maintenanceDueDateSource" DATE,
  ADD COLUMN "purchaseDateSource" DATE,
  ADD COLUMN "bmcIpSource" TEXT,
  ADD COLUMN "cabinetNoSource" TEXT,
  ADD COLUMN "rackPositionSource" TEXT,
  ADD COLUMN "managementCodeSource" TEXT,
  ADD COLUMN "fixedAssetNoSource" TEXT;

-- Index both source and override dimensions used by filtering/search
CREATE INDEX "AssetLedgerFields_companySource_idx" ON "AssetLedgerFields"("companySource");
CREATE INDEX "AssetLedgerFields_companyOverride_idx" ON "AssetLedgerFields"("companyOverride");
CREATE INDEX "AssetLedgerFields_departmentSource_idx" ON "AssetLedgerFields"("departmentSource");
CREATE INDEX "AssetLedgerFields_departmentOverride_idx" ON "AssetLedgerFields"("departmentOverride");
CREATE INDEX "AssetLedgerFields_systemCategorySource_idx" ON "AssetLedgerFields"("systemCategorySource");
CREATE INDEX "AssetLedgerFields_systemCategoryOverride_idx" ON "AssetLedgerFields"("systemCategoryOverride");
CREATE INDEX "AssetLedgerFields_systemLevelSource_idx" ON "AssetLedgerFields"("systemLevelSource");
CREATE INDEX "AssetLedgerFields_systemLevelOverride_idx" ON "AssetLedgerFields"("systemLevelOverride");
