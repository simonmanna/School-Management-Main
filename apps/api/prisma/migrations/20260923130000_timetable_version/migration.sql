-- Timetable history (audit F-14). TimetableSlot stays the live grid; every
-- change appends the resulting grid for that class/section here.
CREATE TABLE IF NOT EXISTS "TimetableVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT,
    "termId" TEXT,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "TimetableVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TimetableVersion_organizationId_classId_sectionId_version_key"
    ON "TimetableVersion"("organizationId", "classId", "sectionId", "version");
CREATE INDEX IF NOT EXISTS "TimetableVersion_organizationId_idx" ON "TimetableVersion"("organizationId");
CREATE INDEX IF NOT EXISTS "TimetableVersion_classId_sectionId_termId_idx" ON "TimetableVersion"("classId", "sectionId", "termId");

ALTER TABLE "TimetableVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimetableVersion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TimetableVersion";
CREATE POLICY tenant_isolation ON "TimetableVersion"
    USING ("organizationId" = current_setting('app.org_id', true));
