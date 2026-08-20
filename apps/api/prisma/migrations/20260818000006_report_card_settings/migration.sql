-- Report card printable configuration (org-scoped). Applied via psql.
CREATE TABLE IF NOT EXISTS "ReportCardSettings" (
  "id"                       TEXT    NOT NULL,
  "organizationId"          TEXT    NOT NULL,
  "showSchoolLogo"          BOOLEAN NOT NULL DEFAULT true,
  "showStudentPhoto"        BOOLEAN NOT NULL DEFAULT true,
  "showWatermark"           BOOLEAN NOT NULL DEFAULT false,
  "showClassTeacherComment" BOOLEAN NOT NULL DEFAULT true,
  "showHeadTeacherComment"  BOOLEAN NOT NULL DEFAULT true,
  "showTermStartDate"       BOOLEAN NOT NULL DEFAULT false,
  "showTermEndDate"         BOOLEAN NOT NULL DEFAULT true,
  "showFeesBalance"         BOOLEAN NOT NULL DEFAULT false,
  "showSchoolMotto"         BOOLEAN NOT NULL DEFAULT true,
  "schoolNameColor"         TEXT    NOT NULL DEFAULT '#000000',
  "schoolAddressColor"      TEXT    NOT NULL DEFAULT '#000000',
  "contactColor"            TEXT    NOT NULL DEFAULT '#000000',
  "websiteColor"            TEXT    NOT NULL DEFAULT '#000000',
  "emailColor"              TEXT    NOT NULL DEFAULT '#000000',
  "reportTitleColor"        TEXT    NOT NULL DEFAULT '#000000',
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportCardSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportCardSettings_organizationId_key" ON "ReportCardSettings"("organizationId");
CREATE INDEX IF NOT EXISTS "ReportCardSettings_organizationId_idx" ON "ReportCardSettings"("organizationId");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReportCardSettings_organizationId_fkey'
  ) THEN
    ALTER TABLE "ReportCardSettings" ADD CONSTRAINT "ReportCardSettings_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
