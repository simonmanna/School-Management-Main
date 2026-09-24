-- Wave 7 (E2E audit P3): two unique keys that a NULL column let through.
-- Postgres treats NULLs as distinct, so
--   TimetableVersion (org, class, NULL section, version)  -- a class with no streams
--   AcademicReminderLog (org, kind, subject, milestone, NULL user) -- a school-wide reminder
-- could be written twice. A partial unique index covers each NULL case; the
-- Prisma-managed @@unique still covers the non-NULL case.

CREATE UNIQUE INDEX IF NOT EXISTS "TimetableVersion_unsectioned_version_key"
  ON "TimetableVersion" ("organizationId", "classId", "version")
  WHERE "sectionId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "AcademicReminderLog_no_user_key"
  ON "AcademicReminderLog" ("organizationId", "kind", "subjectId", "milestone")
  WHERE "userId" IS NULL;
