-- Timetable P1/P2/P3: double periods, rotation cycles, managed rooms,
-- teacher availability, and temporary overrides.

ALTER TABLE "TimetableSlot"
  ADD COLUMN "spanPeriods" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cycle" TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN "teachingRoomId" TEXT;

CREATE TABLE "TeachingRoom" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 30,
  "type" TEXT NOT NULL DEFAULT 'classroom',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  CONSTRAINT "TeachingRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeachingRoom_organizationId_name_key" ON "TeachingRoom"("organizationId","name");
CREATE INDEX "TeachingRoom_organizationId_idx" ON "TeachingRoom"("organizationId");

CREATE TABLE "TeacherAvailability" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teacherPartnerId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "periodId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'available',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeacherAvailability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeacherAvailability_organizationId_teacherPartnerId_dayOfWeek_periodId_key"
  ON "TeacherAvailability"("organizationId","teacherPartnerId","dayOfWeek","periodId");
CREATE INDEX "TeacherAvailability_organizationId_idx" ON "TeacherAvailability"("organizationId");
CREATE INDEX "TeacherAvailability_teacherPartnerId_dayOfWeek_idx" ON "TeacherAvailability"("teacherPartnerId","dayOfWeek");

CREATE TABLE "TimetableRotation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "activeCycle" TEXT NOT NULL DEFAULT 'all',
  "switchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimetableRotation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TimetableRotation_classId_key" ON "TimetableRotation"("classId");
CREATE INDEX "TimetableRotation_organizationId_idx" ON "TimetableRotation"("organizationId");

CREATE TABLE "TimetableOverride" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "sectionId" TEXT,
  "dayOfWeek" INTEGER NOT NULL,
  "periodId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3) NOT NULL,
  "subjectId" TEXT,
  "teacherPartnerId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  CONSTRAINT "TimetableOverride_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimetableOverride_organizationId_idx" ON "TimetableOverride"("organizationId");
CREATE INDEX "TimetableOverride_classId_dayOfWeek_periodId_idx" ON "TimetableOverride"("classId","dayOfWeek","periodId");

CREATE INDEX "TimetableSlot_teachingRoomId_idx" ON "TimetableSlot"("teachingRoomId");
