-- P-att-status: make attendance statuses organization-configurable.
-- The rigid AttendanceStatus enum is dropped; StudentAttendance.status becomes
-- a free TEXT column holding the AttendanceStatusConfig.code. A new
-- AttendanceStatusConfig table (one row per org per status) carries the
-- display metadata (label/colour) and the roll-up flags used by rate maths and
-- parent alerts. The seed ships Absent / Present / Late.

-- ─────────────────────────────── Table ───────────────────────────────
CREATE TABLE "AttendanceStatusConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPresent" BOOLEAN NOT NULL DEFAULT false,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceStatusConfig_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────── Alter StudentAttendance ───────────────────────────────
-- Drop the enum-typed column default lives on the type; we retype to TEXT.
ALTER TABLE "StudentAttendance" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "StudentAttendance" ALTER COLUMN "status" SET DEFAULT 'present';
ALTER TABLE "StudentAttendance" ADD COLUMN "statusCfgId" TEXT;

-- ─────────────────────────────── Indexes ───────────────────────────────
CREATE UNIQUE INDEX "AttendanceStatusConfig_organizationId_code_key" ON "AttendanceStatusConfig"("organizationId", "code");
CREATE INDEX "AttendanceStatusConfig_organizationId_idx" ON "AttendanceStatusConfig"("organizationId");
CREATE INDEX "AttendanceStatusConfig_organizationId_isDefault_idx" ON "AttendanceStatusConfig"("organizationId", "isDefault");
CREATE INDEX "StudentAttendance_statusCfgId_idx" ON "StudentAttendance"("statusCfgId");

-- ─────────────────────────────── Foreign keys ───────────────────────────────
ALTER TABLE "AttendanceStatusConfig" ADD CONSTRAINT "AttendanceStatusConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_statusCfgId_fkey" FOREIGN KEY ("statusCfgId") REFERENCES "AttendanceStatusConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────── Drop old enum ───────────────────────────────
DROP TYPE IF EXISTS "AttendanceStatus";
