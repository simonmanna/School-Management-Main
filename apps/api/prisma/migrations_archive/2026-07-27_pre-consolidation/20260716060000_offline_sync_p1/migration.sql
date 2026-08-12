-- P1 offline sync: device registry, dead-lettered ops, provisional numbers.
-- (Hand-authored per repo convention: db-push-first environments resolve this
--  with `prisma migrate resolve --applied`; CI applies it with migrate dev.)

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "deviceId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "provisionalNumber" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "provisionalNumber" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "provisionalNumber" TEXT;

-- CreateTable
CREATE TABLE "PosDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "registeredById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastPushSeq" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOpDeadLetter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "opId" TEXT NOT NULL,
    "deviceSeq" INTEGER NOT NULL,
    "opType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOpDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosDevice_organizationId_idx" ON "PosDevice"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PosDevice_organizationId_tokenHash_key" ON "PosDevice"("organizationId", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PosDevice_organizationId_prefix_key" ON "PosDevice"("organizationId", "prefix");

-- CreateIndex
CREATE INDEX "SyncOpDeadLetter_organizationId_status_idx" ON "SyncOpDeadLetter"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SyncOpDeadLetter_organizationId_deviceId_idx" ON "SyncOpDeadLetter"("organizationId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOpDeadLetter_organizationId_opId_key" ON "SyncOpDeadLetter"("organizationId", "opId");
