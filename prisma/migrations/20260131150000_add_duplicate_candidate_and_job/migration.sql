-- CreateEnum
CREATE TYPE "DuplicateCandidateStatus" AS ENUM ('open', 'ignored', 'merged');

-- CreateEnum
CREATE TYPE "DuplicateCandidateJobStatus" AS ENUM ('Queued', 'Running', 'Succeeded', 'Failed');

-- CreateTable
CREATE TABLE "DuplicateCandidate" (
    "id" TEXT NOT NULL,
    "assetUuidA" UUID NOT NULL,
    "assetUuidB" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "DuplicateCandidateStatus" NOT NULL DEFAULT 'open',
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ignoredByUserId" TEXT,
    "ignoredAt" TIMESTAMP(3),
    "ignoreReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateCandidateJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "DuplicateCandidateJobStatus" NOT NULL DEFAULT 'Queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateCandidateJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidate_assetUuidA_assetUuidB_key" ON "DuplicateCandidate"("assetUuidA", "assetUuidB");

-- CreateIndex
CREATE INDEX "DuplicateCandidate_status_lastObservedAt_idx" ON "DuplicateCandidate"("status", "lastObservedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateCandidateJob_runId_key" ON "DuplicateCandidateJob"("runId");

-- CreateIndex
CREATE INDEX "DuplicateCandidateJob_status_createdAt_idx" ON "DuplicateCandidateJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_assetUuidA_fkey" FOREIGN KEY ("assetUuidA") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_assetUuidB_fkey" FOREIGN KEY ("assetUuidB") REFERENCES "Asset"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidate" ADD CONSTRAINT "DuplicateCandidate_ignoredByUserId_fkey" FOREIGN KEY ("ignoredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateCandidateJob" ADD CONSTRAINT "DuplicateCandidateJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

