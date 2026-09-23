-- Subject configuration (audit F-28): active flag, ordering, academic level.
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "academicLevelId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Subject" ADD CONSTRAINT "Subject_academicLevelId_fkey"
    FOREIGN KEY ("academicLevelId") REFERENCES "AcademicLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Subject_academicLevelId_idx" ON "Subject"("academicLevelId");
CREATE INDEX IF NOT EXISTS "Subject_organizationId_isActive_displayOrder_idx" ON "Subject"("organizationId", "isActive", "displayOrder");

-- Same-tenant guard for the new reference (see 20260923110000_tenant_fk_guard).
DROP TRIGGER IF EXISTS tenant_fk_subject_academic_level ON "Subject";
DO $$
DECLARE trg text := 'tenant_fk_' || left(md5('Subject_academicLevelId_fkey'), 24);
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON "Subject"', trg);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "academicLevelId" ON "Subject" FOR EACH ROW EXECUTE FUNCTION enforce_same_org_fk(%L, %L)',
    trg, 'academicLevelId', 'AcademicLevel');
END $$;
