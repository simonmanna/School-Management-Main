-- Wave 4 · one ACTIVE enrollment per pupil across all years, and no duplicate
-- course offering for a cohort. Pre-check: 0 pupils with two ACTIVE
-- enrollments; 0 duplicate cohort offerings (44 duplicate groups exist only for
-- school-level offerings with no cohort, which this index deliberately skips).
CREATE UNIQUE INDEX IF NOT EXISTS "StudentEnrollment_one_active_per_student"
  ON "StudentEnrollment" ("studentProfileId") WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "CourseOffering_one_per_cohort_subject_section"
  ON "CourseOffering" ("organizationId", "termId", "classCohortId", "subjectId", COALESCE("sectionId", ''))
  WHERE "classCohortId" IS NOT NULL AND "deletedAt" IS NULL;
