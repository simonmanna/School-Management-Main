-- Attendance Management P0/P1/P2: new statuses, corrections support,
-- threshold config, and parent-alert engine.

-- 1) Extend the AttendanceStatus enum with early departure + unexcused.
--    Postgres cannot add enum values inside a transaction, so each is its own
--    statement (Prisma executes the whole file non-transactionally per value).
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'early_departure';
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'unexcused';

-- 2) AttendanceThreshold table.
CREATE TABLE IF NOT EXISTS "AttendanceThreshold" (
  "id"                      TEXT NOT NULL,
  "organizationId"          TEXT NOT NULL,
  "classId"                 TEXT,
  "minAttendancePct"        DOUBLE PRECISION NOT NULL DEFAULT 75,
  "notifyAbsent"            BOOLEAN NOT NULL DEFAULT true,
  "notifyLate"              BOOLEAN NOT NULL DEFAULT true,
  "notifyEarly"             BOOLEAN NOT NULL DEFAULT true,
  "notifyBelowThreshold"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AttendanceThreshold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AttendanceThreshold_organizationId_idx" ON "AttendanceThreshold" ("organizationId");
CREATE INDEX IF NOT EXISTS "AttendanceThreshold_organizationId_classId_idx" ON "AttendanceThreshold" ("organizationId", "classId");
