-- Add AD source type and user auth model.
ALTER TYPE "SourceType" ADD VALUE 'activedirectory';

CREATE TYPE "UserAuthType" AS ENUM ('local', 'ldap');

ALTER TABLE "User"
  ADD COLUMN "authType" "UserAuthType" NOT NULL DEFAULT 'local',
  ADD COLUMN "externalAuthId" TEXT,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User"
  ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_externalAuthId_key" ON "User"("externalAuthId");
CREATE INDEX "User_authType_enabled_idx" ON "User"("authType", "enabled");

-- Directory data models for AD collect mode.
CREATE TABLE "DirectoryDomain" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "domainDn" TEXT NOT NULL,
  "dnsRoot" TEXT,
  "netbiosName" TEXT,
  "objectGuid" TEXT,
  "raw" JSONB NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectoryDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DirectoryUser" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "objectGuid" TEXT NOT NULL,
  "dn" TEXT NOT NULL,
  "upn" TEXT,
  "samAccountName" TEXT,
  "displayName" TEXT,
  "mail" TEXT,
  "enabled" BOOLEAN,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DirectoryUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DirectoryUserSnapshot" (
  "id" TEXT NOT NULL,
  "directoryUserId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "profile" JSONB NOT NULL,
  "raw" JSONB NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DirectoryUserSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectoryDomain_sourceId_domainDn_key" ON "DirectoryDomain"("sourceId", "domainDn");
CREATE INDEX "DirectoryDomain_runId_idx" ON "DirectoryDomain"("runId");
CREATE INDEX "DirectoryDomain_sourceId_collectedAt_idx" ON "DirectoryDomain"("sourceId", "collectedAt" DESC);

CREATE UNIQUE INDEX "DirectoryUser_sourceId_objectGuid_key" ON "DirectoryUser"("sourceId", "objectGuid");
CREATE INDEX "DirectoryUser_sourceId_upn_idx" ON "DirectoryUser"("sourceId", "upn");
CREATE INDEX "DirectoryUser_sourceId_samAccountName_idx" ON "DirectoryUser"("sourceId", "samAccountName");
CREATE INDEX "DirectoryUser_sourceId_lastSeenAt_idx" ON "DirectoryUser"("sourceId", "lastSeenAt" DESC);

CREATE INDEX "DirectoryUserSnapshot_runId_idx" ON "DirectoryUserSnapshot"("runId");
CREATE INDEX "DirectoryUserSnapshot_directoryUserId_collectedAt_idx" ON "DirectoryUserSnapshot"("directoryUserId", "collectedAt" DESC);
CREATE INDEX "DirectoryUserSnapshot_sourceId_collectedAt_idx" ON "DirectoryUserSnapshot"("sourceId", "collectedAt" DESC);

ALTER TABLE "DirectoryDomain"
  ADD CONSTRAINT "DirectoryDomain_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryDomain"
  ADD CONSTRAINT "DirectoryDomain_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryUser"
  ADD CONSTRAINT "DirectoryUser_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryUserSnapshot"
  ADD CONSTRAINT "DirectoryUserSnapshot_directoryUserId_fkey"
  FOREIGN KEY ("directoryUserId") REFERENCES "DirectoryUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryUserSnapshot"
  ADD CONSTRAINT "DirectoryUserSnapshot_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectoryUserSnapshot"
  ADD CONSTRAINT "DirectoryUserSnapshot_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
