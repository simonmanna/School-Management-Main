-- Wave 4 · the same child cannot be entered twice for one year, unless an
-- officer explicitly says it is a different child (twins, a common name).
-- The service checked name + date of birth with a findFirst, which two
-- simultaneous submissions both passed. Pre-check: 0 duplicates.
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "allowDuplicate" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionApplication_applicant_dedupe"
  ON "AdmissionApplication" ("organizationId", "academicYearId", lower("applicantFirstName"), lower("applicantLastName"), "applicantDob")
  WHERE NOT "allowDuplicate" AND "applicantDob" IS NOT NULL AND "deletedAt" IS NULL
    AND status NOT IN ('withdrawn', 'rejected');
