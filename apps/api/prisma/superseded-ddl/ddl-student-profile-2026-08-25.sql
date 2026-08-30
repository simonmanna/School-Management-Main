-- Student Profile CRUD hardening: new status values + EmergencyContact table.
-- Idempotent. Run against schooldb-planet (DO NOT use `prisma migrate dev`).
-- psql example:
--   set PGBIN="C:/Program Files/PostgreSQL/18/bin"
--   PGPASSWORD=postgres "%PGBIN%/psql.exe" -h localhost -p 5432 -U postgres -d schooldb-planet -f ddl-student-profile-2026-08-25.sql

-- 1) Extend the StudentStatus enum with the new lifecycle states.
--    Postgres: ALTER TYPE ... ADD VALUE is safe to run repeatedly only if we
--    guard it; we wrap each in a DO block that checks pg_enum first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StudentStatus' AND e.enumlabel = 'applicant'
  ) THEN
    ALTER TYPE "StudentStatus" ADD VALUE 'applicant';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StudentStatus' AND e.enumlabel = 'graduated'
  ) THEN
    ALTER TYPE "StudentStatus" ADD VALUE 'graduated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StudentStatus' AND e.enumlabel = 'deceased'
  ) THEN
    ALTER TYPE "StudentStatus" ADD VALUE 'deceased';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'StudentStatus' AND e.enumlabel = 'archived'
  ) THEN
    ALTER TYPE "StudentStatus" ADD VALUE 'archived';
  END IF;
END $$;

-- 2) Create the EmergencyContact table (standalone, not an AR Contact).
CREATE TABLE IF NOT EXISTS "EmergencyContact" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "firstName"        TEXT NOT NULL,
  "middleName"       TEXT,
  "lastName"         TEXT,
  "preferredName"    TEXT,
  "relationship"     TEXT,
  "phone"            TEXT,
  "alternativePhone" TEXT,
  "email"            TEXT,
  "address"          TEXT,
  "priority"         INTEGER NOT NULL DEFAULT 1,
  "authorizedPickup" BOOLEAN NOT NULL DEFAULT FALSE,
  "customFields"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "deletedAt"        TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "EmergencyContact_organizationId_idx" ON "EmergencyContact" ("organizationId");
CREATE INDEX IF NOT EXISTS "EmergencyContact_studentProfileId_idx" ON "EmergencyContact" ("studentProfileId");

-- 3) FK from EmergencyContact -> StudentProfile (cascade delete).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmergencyContact_studentProfileId_fkey'
  ) THEN
    ALTER TABLE "EmergencyContact"
      ADD CONSTRAINT "EmergencyContact_studentProfileId_fkey"
      FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
