-- ============================================================================
-- Student Categories — org-scoped master data + FK onto StudentProfile / Application
-- ----------------------------------------------------------------------------
-- Idempotent. Run against schooldb-planet (DO NOT use `prisma migrate dev`).
--   set PGBIN="C:/Program Files/PostgreSQL/18/bin"
--   PGPASSWORD=postgres "%PGBIN%/psql.exe" -h localhost -p 5432 -U postgres ^
--     -d schooldb-planet -f ddl-student-category-2026-08-29.sql
-- ============================================================================

-- 1) StudentCategory master table (mirrors the Nationality pattern: soft-deactivatable).
CREATE TABLE IF NOT EXISTS "StudentCategory" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_student_category_org_name" UNIQUE ("organizationId", "name")
);
CREATE INDEX IF NOT EXISTS "idx_student_category_org" ON "StudentCategory" ("organizationId");
CREATE INDEX IF NOT EXISTS "idx_student_category_org_active" ON "StudentCategory" ("organizationId", "isActive");

-- 2) FK onto StudentProfile (nullable — a category is optional).
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "studentCategoryId" TEXT;
CREATE INDEX IF NOT EXISTS "idx_student_profile_category" ON "StudentProfile" ("studentCategoryId");

-- 3) FK onto AdmissionApplication (nullable — chosen at apply time).
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "studentCategoryId" TEXT;
CREATE INDEX IF NOT EXISTS "idx_admission_application_category" ON "AdmissionApplication" ("studentCategoryId");
