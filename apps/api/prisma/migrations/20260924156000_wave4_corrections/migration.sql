-- Wave 4 corrections, found by the wave4-db-constraints spec:
--
-- 1. TimetableOverride.teacherPartnerId, like TimetableSlot.teacherPartnerId, is
--    a StaffProfile id (timetable-advanced.service resolves it there), not a
--    Partner id. Repoint the FK added in 20260924153000. (0 override rows existed.)
ALTER TABLE "TimetableOverride" DROP CONSTRAINT IF EXISTS "TimetableOverride_teacherPartnerId_fkey";
ALTER TABLE "TimetableOverride" ADD CONSTRAINT "TimetableOverride_teacherPartnerId_fkey"
  FOREIGN KEY ("teacherPartnerId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. An older dedupe index (20260820120000) had no exemption for a confirmed
--    different child, and also blocked re-applying after a withdrawal or
--    rejection. Replace both with one index carrying the same normalisation
--    (trimmed, case-folded names; a missing DOB still matches) and the override.
DROP INDEX IF EXISTS "AdmissionApplication_dedupe_key";
DROP INDEX IF EXISTS "AdmissionApplication_applicant_dedupe";
CREATE UNIQUE INDEX "AdmissionApplication_applicant_dedupe"
  ON "AdmissionApplication" (
    "organizationId", "academicYearId",
    lower(btrim("applicantFirstName")), lower(btrim("applicantLastName")),
    COALESCE("applicantDob", '0001-01-01 00:00:00'::timestamp)
  )
  WHERE NOT "allowDuplicate" AND "deletedAt" IS NULL AND status NOT IN ('withdrawn', 'rejected');

-- Same-org guard for the repointed FK.
DO $$
DECLARE trg text := 'tenant_fk_' || left(md5('TimetableOverride_teacherPartnerId_fkey'), 24);
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON "TimetableOverride"', trg);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "teacherPartnerId" ON "TimetableOverride" FOR EACH ROW EXECUTE FUNCTION enforce_same_org_fk(%L, %L)',
                 trg, 'teacherPartnerId', 'StaffProfile');
END $$;
