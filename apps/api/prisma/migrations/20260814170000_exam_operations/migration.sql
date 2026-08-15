-- A4 exam operations: ExamVenue, ExamRegistration (replaces Exam.classes JSON),
-- and session detail on ExamSchedule. Backfills registrations from the legacy
-- Exam.classes arrays.

-- ─────────────────────────────── Enum ───────────────────────────────
CREATE TYPE "ExamRegistrationStatus" AS ENUM ('registered', 'sat', 'absent', 'withheld');

-- ─────────────────────── ExamSchedule session fields ───────────────────────
ALTER TABLE "ExamSchedule" ADD COLUMN "paperNumber" INTEGER;
ALTER TABLE "ExamSchedule" ADD COLUMN "sitting" TEXT;
ALTER TABLE "ExamSchedule" ADD COLUMN "isResit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExamSchedule" ADD COLUMN "venueId" TEXT;
CREATE INDEX "ExamSchedule_venueId_idx" ON "ExamSchedule"("venueId");

-- ─────────────────────────────── Tables ───────────────────────────────
CREATE TABLE "ExamVenue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ExamVenue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamRegistration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "classId" TEXT,
    "venueId" TEXT,
    "seatNumber" TEXT,
    "status" "ExamRegistrationStatus" NOT NULL DEFAULT 'registered',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamRegistration_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────── Indexes / uniques ───────────────────────────
CREATE UNIQUE INDEX "ExamVenue_org_name_unique" ON "ExamVenue"("organizationId", "name");
CREATE INDEX "ExamVenue_organizationId_idx" ON "ExamVenue"("organizationId");

CREATE UNIQUE INDEX "ExamRegistration_exam_student_unique" ON "ExamRegistration"("examId", "studentProfileId");
CREATE INDEX "ExamRegistration_organizationId_idx" ON "ExamRegistration"("organizationId");
CREATE INDEX "ExamRegistration_examId_idx" ON "ExamRegistration"("examId");
CREATE INDEX "ExamRegistration_org_student_idx" ON "ExamRegistration"("organizationId", "studentProfileId");

-- ─────────────────────────── Foreign keys ───────────────────────────
ALTER TABLE "ExamSchedule" ADD CONSTRAINT "ExamSchedule_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ExamVenue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExamRegistration" ADD CONSTRAINT "ExamRegistration_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamRegistration" ADD CONSTRAINT "ExamRegistration_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "ExamVenue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────── CHECK ───────────────────────────
ALTER TABLE "ExamVenue" ADD CONSTRAINT "ExamVenue_capacity_check" CHECK ("capacity" > 0);

-- ─────────────────────────── Backfill registrations from Exam.classes ───────────────────────────
-- Expand each exam's legacy class-id array and register every active student in
-- those classes. Idempotent via the (examId, studentProfileId) unique index.
INSERT INTO "ExamRegistration" ("id", "organizationId", "examId", "studentProfileId", "classId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), e."organizationId", e."id", sp."id", cls.value, 'registered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Exam" e
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(e."classes"::jsonb) = 'array' THEN e."classes"::jsonb ELSE '[]'::jsonb END
) AS cls(value)
JOIN "StudentProfile" sp
    ON sp."currentClassId" = cls.value
    AND sp."organizationId" = e."organizationId"
    AND sp."status" = 'active'
    AND sp."deletedAt" IS NULL
ON CONFLICT ("examId", "studentProfileId") DO NOTHING;

-- ─────────────────────────── RLS (inert; companion to app-side ORG_SCOPED) ───────────────────────────
DO $$
DECLARE
    t text;
    a4_tables text[] := ARRAY['ExamVenue', 'ExamRegistration'];
BEGIN
    FOREACH t IN ARRAY a4_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
