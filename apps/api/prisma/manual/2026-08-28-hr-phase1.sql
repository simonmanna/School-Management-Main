-- HR Phase 1: skills, experience, personnel documents + documentId→File FKs.
-- Applied surgically (not via `db push`) because the dev DB has pre-existing
-- schema drift that a full push would try to reconcile. Defensive + idempotent.

-- ── 1. New tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HrSkill" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP,
  CONSTRAINT "HrSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HrSkill_organizationId_code_key" ON "HrSkill"("organizationId","code");
CREATE INDEX IF NOT EXISTS "HrSkill_organizationId_deletedAt_idx" ON "HrSkill"("organizationId","deletedAt");

CREATE TABLE IF NOT EXISTS "HrEmployeeSkill" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "proficiency" TEXT NOT NULL DEFAULT 'intermediate',
  "yearsExperience" DECIMAL(5,2),
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP,
  CONSTRAINT "HrEmployeeSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployeeSkill_organizationId_employeeId_skillId_key" ON "HrEmployeeSkill"("organizationId","employeeId","skillId");
CREATE INDEX IF NOT EXISTS "HrEmployeeSkill_organizationId_employeeId_deletedAt_idx" ON "HrEmployeeSkill"("organizationId","employeeId","deletedAt");
CREATE INDEX IF NOT EXISTS "HrEmployeeSkill_organizationId_skillId_idx" ON "HrEmployeeSkill"("organizationId","skillId");

CREATE TABLE IF NOT EXISTS "HrExperience" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employer" TEXT NOT NULL,
  "title" TEXT,
  "startDate" TIMESTAMP,
  "endDate" TIMESTAMP,
  "description" TEXT,
  "referenceName" TEXT,
  "referenceContact" TEXT,
  "documentId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP,
  CONSTRAINT "HrExperience_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HrExperience_organizationId_employeeId_deletedAt_idx" ON "HrExperience"("organizationId","employeeId","deletedAt");

CREATE TABLE IF NOT EXISTS "HrEmployeeDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "type" TEXT,
  "title" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP,
  CONSTRAINT "HrEmployeeDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HrEmployeeDocument_organizationId_employeeId_deletedAt_idx" ON "HrEmployeeDocument"("organizationId","employeeId","deletedAt");
CREATE INDEX IF NOT EXISTS "HrEmployeeDocument_organizationId_expiresAt_idx" ON "HrEmployeeDocument"("organizationId","expiresAt");

-- ── 2. updatedAt on the two credential tables ────────────────────────────────
ALTER TABLE "HrQualification"  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HrQualification"  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
ALTER TABLE "HrCertification"  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HrCertification"  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

-- ── 3. Foreign keys (all ON DELETE SET NULL for optional doc pointers) ───────
DO $$ BEGIN
  ALTER TABLE "HrEmployeeSkill"    ADD CONSTRAINT "HrEmployeeSkill_employeeId_fkey"    FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrEmployeeSkill"    ADD CONSTRAINT "HrEmployeeSkill_skillId_fkey"       FOREIGN KEY ("skillId")    REFERENCES "HrSkill"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrExperience"       ADD CONSTRAINT "HrExperience_employeeId_fkey"       FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrExperience"       ADD CONSTRAINT "HrExperience_documentId_fkey"       FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_employeeId_fkey"  FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_fileId_fkey"      FOREIGN KEY ("fileId")     REFERENCES "File"("id")       ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrQualification"    ADD CONSTRAINT "HrQualification_documentId_fkey"     FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrCertification"    ADD CONSTRAINT "HrCertification_documentId_fkey"     FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrContract"         ADD CONSTRAINT "HrContract_documentId_fkey"          FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrSalaryChange"     ADD CONSTRAINT "HrSalaryChange_documentId_fkey"      FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HrApplicant"        ADD CONSTRAINT "HrApplicant_documentId_fkey"         FOREIGN KEY ("documentId") REFERENCES "File"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
