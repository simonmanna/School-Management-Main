-- =============================================================================
-- School vertical migration (Sprints 1–11 consolidated)
-- Generated: 2026-06-23
--
-- Adds all school tables (foundation, people, admissions, academics,
-- attendance, LMS, exams, fees, communication, library, transport, hostel,
-- cafeteria, reporting). Every table is org-scoped (organizationId NOT NULL)
-- except where noted. Soft-delete columns are added on master data tables.
--
-- NOTE: This migration deliberately does NOT touch the existing Phase 0–G
-- tables; the school vertical lives alongside them.
-- =============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "StudentStatus" AS ENUM ('active', 'suspended', 'transferred', 'withdrawn', 'alumni');
CREATE TYPE "StaffStatus"   AS ENUM ('active', 'on_leave', 'suspended', 'terminated', 'retired');
CREATE TYPE "AdmissionStatus" AS ENUM ('submitted', 'under_review', 'exam_scheduled', 'accepted', 'rejected', 'enrolled', 'withdrawn');
CREATE TYPE "ExamStatus"    AS ENUM ('draft', 'scheduled', 'published', 'closed');
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE "GradeEntryStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE "DiscountType"  AS ENUM ('percent', 'fixed');
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed');
CREATE TYPE "NotificationChannel" AS ENUM ('sms', 'email', 'push', 'in_app');

-- ── Sprint 1: Foundation ────────────────────────────────────────────────────

CREATE TABLE "Campus" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "addressId"      TEXT,
  "phone"          TEXT,
  "email"          TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Campus_organizationId_code_key" ON "Campus"("organizationId","code");
CREATE INDEX "Campus_organizationId_idx" ON "Campus"("organizationId");

CREATE TABLE "SchoolProfile" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "motto"          TEXT,
  "logoUrl"        TEXT,
  "address"        TEXT,
  "phone"          TEXT,
  "email"          TEXT,
  "website"        TEXT,
  "country"        TEXT NOT NULL DEFAULT 'UG',
  "currencyCode"   TEXT NOT NULL DEFAULT 'UGX',
  "educationLevel" TEXT NOT NULL DEFAULT 'mixed',
  "gradingSystem"  TEXT NOT NULL DEFAULT 'UCE',
  "contacts"       JSONB NOT NULL DEFAULT '{}',
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchoolProfile_organizationId_key" ON "SchoolProfile"("organizationId");
CREATE INDEX "SchoolProfile_organizationId_idx" ON "SchoolProfile"("organizationId");

CREATE TABLE "AcademicYear" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "isCurrent"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AcademicYear_organizationId_name_key" ON "AcademicYear"("organizationId","name");
CREATE INDEX "AcademicYear_organizationId_idx" ON "AcademicYear"("organizationId");

CREATE TABLE "Term" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL REFERENCES "AcademicYear"("id"),
  "name"           TEXT NOT NULL,
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "isCurrent"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Term_organizationId_academicYearId_name_key" ON "Term"("organizationId","academicYearId","name");
CREATE INDEX "Term_organizationId_idx" ON "Term"("organizationId");
CREATE INDEX "Term_academicYearId_idx" ON "Term"("academicYearId");

CREATE TABLE "Department" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "headId"         TEXT,
  "description"    TEXT,
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Department_organizationId_name_key" ON "Department"("organizationId","name");
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

CREATE TABLE "GradeLevel" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "GradeLevel_organizationId_name_key" ON "GradeLevel"("organizationId","name");
CREATE INDEX "GradeLevel_organizationId_idx" ON "GradeLevel"("organizationId");

CREATE TABLE "SchoolClass" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "campusId"           TEXT REFERENCES "Campus"("id"),
  "gradeLevelId"       TEXT NOT NULL REFERENCES "GradeLevel"("id"),
  "name"               TEXT NOT NULL,
  "homeroomTeacherId"  TEXT,
  "capacity"           INTEGER NOT NULL DEFAULT 40,
  "customFields"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"          TEXT,
  "updatedBy"          TEXT,
  "deletedAt"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX "SchoolClass_organizationId_name_key" ON "SchoolClass"("organizationId","name");
CREATE INDEX "SchoolClass_organizationId_idx" ON "SchoolClass"("organizationId");
CREATE INDEX "SchoolClass_campusId_idx" ON "SchoolClass"("campusId");
CREATE INDEX "SchoolClass_gradeLevelId_idx" ON "SchoolClass"("gradeLevelId");

CREATE TABLE "Section" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "classId"        TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "name"           TEXT NOT NULL,
  "capacity"       INTEGER NOT NULL DEFAULT 40,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Section_organizationId_classId_name_key" ON "Section"("organizationId","classId","name");
CREATE INDEX "Section_organizationId_idx" ON "Section"("organizationId");
CREATE INDEX "Section_classId_idx" ON "Section"("classId");

CREATE TABLE "Subject" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "departmentId"   TEXT REFERENCES "Department"("id"),
  "isCore"         BOOLEAN NOT NULL DEFAULT true,
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Subject_organizationId_code_key" ON "Subject"("organizationId","code");
CREATE INDEX "Subject_organizationId_idx" ON "Subject"("organizationId");
CREATE INDEX "Subject_departmentId_idx" ON "Subject"("departmentId");

CREATE TABLE "Period" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "campusId"       TEXT REFERENCES "Campus"("id"),
  "name"           TEXT NOT NULL,
  "startTime"      TEXT NOT NULL,
  "endTime"        TEXT NOT NULL,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Period_organizationId_campusId_name_key" ON "Period"("organizationId","campusId","name");
CREATE INDEX "Period_organizationId_idx" ON "Period"("organizationId");

CREATE TABLE "SchoolCalendarEvent" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "termId"         TEXT,
  "title"          TEXT NOT NULL,
  "type"           TEXT NOT NULL DEFAULT 'event',
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "description"    TEXT,
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "SchoolCalendarEvent_organizationId_idx" ON "SchoolCalendarEvent"("organizationId");
CREATE INDEX "SchoolCalendarEvent_termId_idx" ON "SchoolCalendarEvent"("termId");
CREATE INDEX "SchoolCalendarEvent_organizationId_startDate_idx" ON "SchoolCalendarEvent"("organizationId","startDate");

-- ── Sprint 2: People ────────────────────────────────────────────────────────

CREATE TABLE "StudentProfile" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "partnerId"        TEXT NOT NULL,
  "admissionNo"      TEXT NOT NULL,
  "currentClassId"   TEXT REFERENCES "SchoolClass"("id"),
  "currentSectionId" TEXT REFERENCES "Section"("id"),
  "enrollmentDate"   TIMESTAMP(3) NOT NULL,
  "status"           "StudentStatus" NOT NULL DEFAULT 'active',
  "dateOfBirth"      TIMESTAMP(3),
  "gender"           TEXT,
  "nationality"      TEXT,
  "religion"         TEXT,
  "residenceType"    TEXT NOT NULL DEFAULT 'day',
  "house"            TEXT,
  "customFields"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"        TEXT,
  "updatedBy"        TEXT,
  "deletedAt"        TIMESTAMP(3)
);
CREATE UNIQUE INDEX "StudentProfile_partnerId_key" ON "StudentProfile"("partnerId");
CREATE UNIQUE INDEX "StudentProfile_organizationId_admissionNo_key" ON "StudentProfile"("organizationId","admissionNo");
CREATE INDEX "StudentProfile_organizationId_idx" ON "StudentProfile"("organizationId");
CREATE INDEX "StudentProfile_currentClassId_idx" ON "StudentProfile"("currentClassId");
CREATE INDEX "StudentProfile_currentSectionId_idx" ON "StudentProfile"("currentSectionId");

CREATE TABLE "StudentStatusHistory" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "fromStatus"       TEXT,
  "toStatus"         TEXT NOT NULL,
  "reason"           TEXT,
  "changedById"      TEXT,
  "changedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudentStatusHistory_organizationId_idx" ON "StudentStatusHistory"("organizationId");
CREATE INDEX "StudentStatusHistory_studentProfileId_idx" ON "StudentStatusHistory"("studentProfileId");

CREATE TABLE "StudentGuardian" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "studentProfileId"   TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "guardianContactId"  TEXT NOT NULL,
  "relationship"       TEXT NOT NULL,
  "isPrimary"          BOOLEAN NOT NULL DEFAULT false,
  "canPickup"          BOOLEAN NOT NULL DEFAULT true,
  "receivesStatements" BOOLEAN NOT NULL DEFAULT true,
  "customFields"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX "StudentGuardian_studentProfileId_guardianContactId_key" ON "StudentGuardian"("studentProfileId","guardianContactId");
CREATE INDEX "StudentGuardian_organizationId_idx" ON "StudentGuardian"("organizationId");
CREATE INDEX "StudentGuardian_guardianContactId_idx" ON "StudentGuardian"("guardianContactId");

CREATE TABLE "MedicalRecord" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "bloodGroup"       TEXT,
  "allergies"        JSONB NOT NULL DEFAULT '[]',
  "conditions"       JSONB NOT NULL DEFAULT '[]',
  "medications"      JSONB NOT NULL DEFAULT '[]',
  "emergencyNotes"   TEXT,
  "doctorName"       TEXT,
  "doctorPhone"      TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MedicalRecord_studentProfileId_key" ON "MedicalRecord"("studentProfileId");
CREATE INDEX "MedicalRecord_organizationId_idx" ON "MedicalRecord"("organizationId");

CREATE TABLE "StudentDocument" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "type"             TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "fileUrl"          TEXT NOT NULL,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMP(3),
  "verified"         BOOLEAN NOT NULL DEFAULT false,
  "verifiedById"     TEXT,
  "verifiedAt"       TIMESTAMP(3),
  "customFields"     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX "StudentDocument_organizationId_idx" ON "StudentDocument"("organizationId");
CREATE INDEX "StudentDocument_studentProfileId_idx" ON "StudentDocument"("studentProfileId");

CREATE TABLE "Position" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "isTeaching"         BOOLEAN NOT NULL DEFAULT false,
  "defaultPermissions" JSONB NOT NULL DEFAULT '[]',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"          TEXT,
  "updatedBy"          TEXT,
  "deletedAt"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Position_organizationId_name_key" ON "Position"("organizationId","name");
CREATE INDEX "Position_organizationId_idx" ON "Position"("organizationId");

CREATE TABLE "StaffProfile" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "partnerId"       TEXT NOT NULL,
  "employeeNo"      TEXT NOT NULL,
  "departmentId"    TEXT REFERENCES "Department"("id"),
  "positionId"      TEXT REFERENCES "Position"("id"),
  "campusId"        TEXT REFERENCES "Campus"("id"),
  "joinDate"        TIMESTAMP(3) NOT NULL,
  "contractType"    TEXT NOT NULL DEFAULT 'permanent',
  "contractEndDate" TIMESTAMP(3),
  "status"          "StaffStatus" NOT NULL DEFAULT 'active',
  "compensation"    JSONB NOT NULL DEFAULT '{}',
  "staffCategory"   TEXT NOT NULL DEFAULT 'teaching',
  "customFields"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"       TEXT,
  "updatedBy"       TEXT,
  "deletedAt"       TIMESTAMP(3)
);
CREATE UNIQUE INDEX "StaffProfile_partnerId_key" ON "StaffProfile"("partnerId");
CREATE UNIQUE INDEX "StaffProfile_organizationId_employeeNo_key" ON "StaffProfile"("organizationId","employeeNo");
CREATE INDEX "StaffProfile_organizationId_idx" ON "StaffProfile"("organizationId");
CREATE INDEX "StaffProfile_departmentId_idx" ON "StaffProfile"("departmentId");
CREATE INDEX "StaffProfile_campusId_idx" ON "StaffProfile"("campusId");

CREATE TABLE "StaffStatusHistory" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL REFERENCES "StaffProfile"("id") ON DELETE CASCADE,
  "fromStatus"     TEXT,
  "toStatus"       TEXT NOT NULL,
  "reason"         TEXT,
  "changedById"    TEXT,
  "changedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StaffStatusHistory_organizationId_idx" ON "StaffStatusHistory"("organizationId");
CREATE INDEX "StaffStatusHistory_staffProfileId_idx" ON "StaffStatusHistory"("staffProfileId");

CREATE TABLE "StaffAttendance" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL REFERENCES "StaffProfile"("id") ON DELETE CASCADE,
  "date"           TIMESTAMP(3) NOT NULL,
  "checkIn"        TIMESTAMP(3),
  "checkOut"       TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'present',
  "notes"          TEXT,
  "markedById"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StaffAttendance_organizationId_staffProfileId_date_key" ON "StaffAttendance"("organizationId","staffProfileId","date");
CREATE INDEX "StaffAttendance_organizationId_idx" ON "StaffAttendance"("organizationId");
CREATE INDEX "StaffAttendance_staffProfileId_idx" ON "StaffAttendance"("staffProfileId");
CREATE INDEX "StaffAttendance_organizationId_date_idx" ON "StaffAttendance"("organizationId","date");

-- ── Sprint 3: Admissions + Academics ───────────────────────────────────────

CREATE TABLE "AdmissionApplication" (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "academicYearId"     TEXT NOT NULL REFERENCES "AcademicYear"("id"),
  "applicationNumber"  TEXT NOT NULL,
  "applicantFirstName" TEXT NOT NULL,
  "applicantLastName"  TEXT NOT NULL,
  "applicantDob"       TIMESTAMP(3),
  "applicantGender"    TEXT,
  "applyingForClassId" TEXT,
  "parentContactId"    TEXT,
  "status"             "AdmissionStatus" NOT NULL DEFAULT 'submitted',
  "submittedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedById"       TEXT,
  "reviewedAt"         TIMESTAMP(3),
  "decisionNotes"      TEXT,
  "customFields"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"          TEXT,
  "updatedBy"          TEXT,
  "deletedAt"          TIMESTAMP(3)
);
CREATE UNIQUE INDEX "AdmissionApplication_organizationId_applicationNumber_key" ON "AdmissionApplication"("organizationId","applicationNumber");
CREATE INDEX "AdmissionApplication_organizationId_idx" ON "AdmissionApplication"("organizationId");
CREATE INDEX "AdmissionApplication_academicYearId_idx" ON "AdmissionApplication"("academicYearId");
CREATE INDEX "AdmissionApplication_status_idx" ON "AdmissionApplication"("status");

CREATE TABLE "ApplicationDocument" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "applicationId"  TEXT NOT NULL REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE,
  "type"           TEXT NOT NULL,
  "fileUrl"        TEXT NOT NULL,
  "uploadedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified"       BOOLEAN NOT NULL DEFAULT false,
  "verifiedById"   TEXT,
  "verifiedAt"     TIMESTAMP(3)
);
CREATE INDEX "ApplicationDocument_organizationId_idx" ON "ApplicationDocument"("organizationId");
CREATE INDEX "ApplicationDocument_applicationId_idx" ON "ApplicationDocument"("applicationId");

CREATE TABLE "EntranceExam" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "applicationId"  TEXT NOT NULL REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE,
  "subjectId"      TEXT NOT NULL REFERENCES "Subject"("id"),
  "scheduledAt"    TIMESTAMP(3),
  "score"          DECIMAL(8,2),
  "maxScore"       DECIMAL(8,2) NOT NULL DEFAULT 100,
  "grade"          TEXT,
  "notes"          TEXT,
  "enteredById"    TEXT,
  "enteredAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "EntranceExam_applicationId_subjectId_key" ON "EntranceExam"("applicationId","subjectId");
CREATE INDEX "EntranceExam_organizationId_idx" ON "EntranceExam"("organizationId");
CREATE INDEX "EntranceExam_applicationId_idx" ON "EntranceExam"("applicationId");

CREATE TABLE "WaitingList" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "applicationId"  TEXT NOT NULL,
  "classId"        TEXT NOT NULL,
  "position"       INTEGER NOT NULL,
  "addedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"          TEXT
);
CREATE UNIQUE INDEX "WaitingList_applicationId_key" ON "WaitingList"("applicationId");
CREATE INDEX "WaitingList_organizationId_idx" ON "WaitingList"("organizationId");
CREATE INDEX "WaitingList_classId_position_idx" ON "WaitingList"("classId","position");

CREATE TABLE "Enrollment" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "applicationId"     TEXT,
  "studentProfileId"  TEXT NOT NULL REFERENCES "StudentProfile"("id"),
  "classId"           TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "sectionId"         TEXT REFERENCES "Section"("id"),
  "termId"            TEXT NOT NULL REFERENCES "Term"("id"),
  "rollNumber"        TEXT NOT NULL,
  "enrolledAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"            TEXT NOT NULL DEFAULT 'enrolled',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Enrollment_applicationId_key" ON "Enrollment"("applicationId");
CREATE UNIQUE INDEX "Enrollment_organizationId_studentProfileId_termId_key" ON "Enrollment"("organizationId","studentProfileId","termId");
CREATE INDEX "Enrollment_organizationId_idx" ON "Enrollment"("organizationId");
CREATE INDEX "Enrollment_classId_idx" ON "Enrollment"("classId");
CREATE INDEX "Enrollment_termId_idx" ON "Enrollment"("termId");

CREATE TABLE "Curriculum" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "classId"        TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL REFERENCES "AcademicYear"("id"),
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Curriculum_organizationId_classId_academicYearId_name_key" ON "Curriculum"("organizationId","classId","academicYearId","name");
CREATE INDEX "Curriculum_organizationId_idx" ON "Curriculum"("organizationId");

CREATE TABLE "CurriculumSubject" (
  "id"             TEXT PRIMARY KEY,
  "curriculumId"   TEXT NOT NULL REFERENCES "Curriculum"("id") ON DELETE CASCADE,
  "subjectId"      TEXT NOT NULL REFERENCES "Subject"("id"),
  "periodsPerWeek" INTEGER NOT NULL DEFAULT 4,
  "isCore"         BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "CurriculumSubject_curriculumId_subjectId_key" ON "CurriculumSubject"("curriculumId","subjectId");
CREATE INDEX "CurriculumSubject_subjectId_idx" ON "CurriculumSubject"("subjectId");

CREATE TABLE "LessonPlan" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "subjectId"        TEXT NOT NULL REFERENCES "Subject"("id"),
  "classId"          TEXT,
  "termId"           TEXT REFERENCES "Term"("id"),
  "teacherPartnerId" TEXT REFERENCES "StaffProfile"("id"),
  "weekOf"           TIMESTAMP(3) NOT NULL,
  "title"            TEXT NOT NULL,
  "objectives"       TEXT,
  "materials"        TEXT,
  "status"           TEXT NOT NULL DEFAULT 'draft',
  "publishedAt"      TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LessonPlan_organizationId_idx" ON "LessonPlan"("organizationId");
CREATE INDEX "LessonPlan_subjectId_idx" ON "LessonPlan"("subjectId");
CREATE INDEX "LessonPlan_teacherPartnerId_idx" ON "LessonPlan"("teacherPartnerId");

CREATE TABLE "TeacherAssignment" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "teacherPartnerId" TEXT NOT NULL REFERENCES "StaffProfile"("id") ON DELETE CASCADE,
  "subjectId"        TEXT NOT NULL REFERENCES "Subject"("id"),
  "classId"          TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "sectionId"        TEXT REFERENCES "Section"("id"),
  "termId"           TEXT REFERENCES "Term"("id"),
  "periodsPerWeek"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_cl_key" ON "TeacherAssignment"("organizationId","teacherPartnerId","subjectId","classId","sectionId","termId");
CREATE INDEX "TeacherAssignment_organizationId_idx" ON "TeacherAssignment"("organizationId");
CREATE INDEX "TeacherAssignment_teacherPartnerId_idx" ON "TeacherAssignment"("teacherPartnerId");
CREATE INDEX "TeacherAssignment_classId_idx" ON "TeacherAssignment"("classId");

CREATE TABLE "TimetableSlot" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "classId"          TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "sectionId"        TEXT REFERENCES "Section"("id"),
  "dayOfWeek"        INTEGER NOT NULL,
  "periodId"         TEXT NOT NULL REFERENCES "Period"("id"),
  "subjectId"        TEXT NOT NULL REFERENCES "Subject"("id"),
  "teacherPartnerId" TEXT REFERENCES "StaffProfile"("id"),
  "campusId"         TEXT REFERENCES "Campus"("id"),
  "room"             TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TimetableSlot_organizationId_idx" ON "TimetableSlot"("organizationId");
CREATE INDEX "TimetableSlot_classId_dayOfWeek_idx" ON "TimetableSlot"("classId","dayOfWeek");
CREATE INDEX "TimetableSlot_teacherPartnerId_dayOfWeek_idx" ON "TimetableSlot"("teacherPartnerId","dayOfWeek");
CREATE INDEX "TimetableSlot_periodId_dayOfWeek_idx" ON "TimetableSlot"("periodId","dayOfWeek");

-- ── Sprint 4: Attendance + LMS ─────────────────────────────────────────────

CREATE TABLE "StudentAttendance" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "classId"          TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "sectionId"        TEXT REFERENCES "Section"("id"),
  "date"             TIMESTAMP(3) NOT NULL,
  "status"           "AttendanceStatus" NOT NULL DEFAULT 'present',
  "minutesLate"      INTEGER NOT NULL DEFAULT 0,
  "reason"           TEXT,
  "markedById"       TEXT,
  "markedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customFields"     JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "StudentAttendance_organizationId_studentProfileId_date_key" ON "StudentAttendance"("organizationId","studentProfileId","date");
CREATE INDEX "StudentAttendance_organizationId_idx" ON "StudentAttendance"("organizationId");
CREATE INDEX "StudentAttendance_classId_date_idx" ON "StudentAttendance"("classId","date");
CREATE INDEX "StudentAttendance_organizationId_date_idx" ON "StudentAttendance"("organizationId","date");

CREATE TABLE "HomeworkAssignment" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "teacherPartnerId" TEXT NOT NULL REFERENCES "StaffProfile"("id"),
  "classId"          TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "sectionId"        TEXT REFERENCES "Section"("id"),
  "subjectId"        TEXT NOT NULL REFERENCES "Subject"("id"),
  "termId"           TEXT REFERENCES "Term"("id"),
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "dueDate"          TIMESTAMP(3) NOT NULL,
  "attachments"      JSONB NOT NULL DEFAULT '[]',
  "maxScore"         DECIMAL(8,2),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3)
);
CREATE INDEX "HomeworkAssignment_organizationId_idx" ON "HomeworkAssignment"("organizationId");
CREATE INDEX "HomeworkAssignment_classId_dueDate_idx" ON "HomeworkAssignment"("classId","dueDate");
CREATE INDEX "HomeworkAssignment_subjectId_idx" ON "HomeworkAssignment"("subjectId");

CREATE TABLE "HomeworkSubmission" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "assignmentId"     TEXT NOT NULL REFERENCES "HomeworkAssignment"("id") ON DELETE CASCADE,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id"),
  "submittedAt"      TIMESTAMP(3),
  "content"          TEXT,
  "attachments"      JSONB NOT NULL DEFAULT '[]',
  "score"            DECIMAL(8,2),
  "gradedById"       TEXT,
  "gradedAt"         TIMESTAMP(3),
  "feedback"         TEXT,
  "status"           TEXT NOT NULL DEFAULT 'assigned'
);
CREATE UNIQUE INDEX "HomeworkSubmission_assignmentId_studentProfileId_key" ON "HomeworkSubmission"("assignmentId","studentProfileId");
CREATE INDEX "HomeworkSubmission_organizationId_idx" ON "HomeworkSubmission"("organizationId");
CREATE INDEX "HomeworkSubmission_studentProfileId_idx" ON "HomeworkSubmission"("studentProfileId");

CREATE TABLE "LearningResource" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "classId"        TEXT,
  "subjectId"      TEXT,
  "title"          TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "url"            TEXT,
  "fileUrl"        TEXT,
  "tags"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  "description"    TEXT,
  "publishedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "LearningResource_organizationId_idx" ON "LearningResource"("organizationId");
CREATE INDEX "LearningResource_classId_idx" ON "LearningResource"("classId");
CREATE INDEX "LearningResource_subjectId_idx" ON "LearningResource"("subjectId");

CREATE TABLE "Announcement" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "scope"          TEXT NOT NULL DEFAULT 'school',
  "scopeId"        TEXT,
  "classId"        TEXT REFERENCES "SchoolClass"("id"),
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "authorId"       TEXT,
  "publishedAt"    TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "priority"       TEXT NOT NULL DEFAULT 'normal',
  "audience"       TEXT[] DEFAULT ARRAY['all']::TEXT[],
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "Announcement_organizationId_idx" ON "Announcement"("organizationId");
CREATE INDEX "Announcement_scope_scopeId_idx" ON "Announcement"("scope","scopeId");
CREATE INDEX "Announcement_organizationId_publishedAt_idx" ON "Announcement"("organizationId","publishedAt");

-- ── Sprint 5: Examinations & Grading ───────────────────────────────────────

CREATE TABLE "ExamType" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "weight"         DECIMAL(5,2) NOT NULL,
  "isFinal"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ExamType_organizationId_name_key" ON "ExamType"("organizationId","name");
CREATE INDEX "ExamType_organizationId_idx" ON "ExamType"("organizationId");

CREATE TABLE "Exam" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "termId"         TEXT NOT NULL REFERENCES "Term"("id"),
  "examTypeId"     TEXT NOT NULL REFERENCES "ExamType"("id"),
  "name"           TEXT NOT NULL,
  "startDate"      TIMESTAMP(3) NOT NULL,
  "endDate"        TIMESTAMP(3) NOT NULL,
  "classes"        JSONB NOT NULL DEFAULT '[]',
  "status"         "ExamStatus" NOT NULL DEFAULT 'draft',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "Exam_organizationId_idx" ON "Exam"("organizationId");
CREATE INDEX "Exam_termId_idx" ON "Exam"("termId");
CREATE INDEX "Exam_status_idx" ON "Exam"("status");

CREATE TABLE "ExamSchedule" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "examId"          TEXT NOT NULL REFERENCES "Exam"("id") ON DELETE CASCADE,
  "classId"         TEXT NOT NULL REFERENCES "SchoolClass"("id"),
  "subjectId"       TEXT NOT NULL REFERENCES "Subject"("id"),
  "date"            TIMESTAMP(3) NOT NULL,
  "startTime"       TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 60,
  "invigilatorId"   TEXT,
  "maxMarks"        DECIMAL(8,2) NOT NULL DEFAULT 100,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ExamSchedule_examId_classId_subjectId_key" ON "ExamSchedule"("examId","classId","subjectId");
CREATE INDEX "ExamSchedule_organizationId_idx" ON "ExamSchedule"("organizationId");
CREATE INDEX "ExamSchedule_classId_date_idx" ON "ExamSchedule"("classId","date");

CREATE TABLE "GradeEntry" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "examScheduleId"   TEXT NOT NULL REFERENCES "ExamSchedule"("id") ON DELETE CASCADE,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id"),
  "marksObtained"    DECIMAL(8,2),
  "maxMarks"         DECIMAL(8,2) NOT NULL,
  "grade"            TEXT,
  "gradePoint"       DECIMAL(4,2),
  "remarks"          TEXT,
  "status"           "GradeEntryStatus" NOT NULL DEFAULT 'draft',
  "enteredById"      TEXT REFERENCES "StaffProfile"("id"),
  "enteredAt"        TIMESTAMP(3),
  "approvedById"     TEXT,
  "approvedAt"       TIMESTAMP(3),
  "customFields"     JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "GradeEntry_examScheduleId_studentProfileId_key" ON "GradeEntry"("examScheduleId","studentProfileId");
CREATE INDEX "GradeEntry_organizationId_idx" ON "GradeEntry"("organizationId");
CREATE INDEX "GradeEntry_studentProfileId_idx" ON "GradeEntry"("studentProfileId");
CREATE INDEX "GradeEntry_status_idx" ON "GradeEntry"("status");

CREATE TABLE "GradingScale" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "bands"          JSONB NOT NULL,
  "isDefault"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "GradingScale_organizationId_name_key" ON "GradingScale"("organizationId","name");
CREATE INDEX "GradingScale_organizationId_idx" ON "GradingScale"("organizationId");

CREATE TABLE "ReportCard" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "termId"           TEXT NOT NULL,
  "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload"          JSONB NOT NULL,
  "pdfUrl"           TEXT,
  "publishedAt"      TIMESTAMP(3),
  "customFields"     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX "ReportCard_organizationId_idx" ON "ReportCard"("organizationId");
CREATE INDEX "ReportCard_studentProfileId_idx" ON "ReportCard"("studentProfileId");
CREATE INDEX "ReportCard_termId_idx" ON "ReportCard"("termId");

CREATE TABLE "AcademicTranscript" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload"          JSONB NOT NULL,
  "pdfUrl"           TEXT
);
CREATE INDEX "AcademicTranscript_organizationId_idx" ON "AcademicTranscript"("organizationId");
CREATE INDEX "AcademicTranscript_studentProfileId_idx" ON "AcademicTranscript"("studentProfileId");

-- ── Sprint 6: Fees (keystone) ──────────────────────────────────────────────

CREATE TABLE "FeeStructure" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL REFERENCES "AcademicYear"("id"),
  "components"     JSONB NOT NULL,
  "applicableTo"   JSONB NOT NULL DEFAULT '{}',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "FeeStructure_organizationId_name_academicYearId_key" ON "FeeStructure"("organizationId","name","academicYearId");
CREATE INDEX "FeeStructure_organizationId_idx" ON "FeeStructure"("organizationId");

CREATE TABLE "FeeSchedule" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "feeStructureId" TEXT NOT NULL REFERENCES "FeeStructure"("id"),
  "termId"         TEXT NOT NULL REFERENCES "Term"("id"),
  "dueDate"        TIMESTAMP(3) NOT NULL,
  "lateFeePolicy"  JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FeeSchedule_organizationId_feeStructureId_termId_key" ON "FeeSchedule"("organizationId","feeStructureId","termId");
CREATE INDEX "FeeSchedule_organizationId_idx" ON "FeeSchedule"("organizationId");
CREATE INDEX "FeeSchedule_termId_idx" ON "FeeSchedule"("termId");

CREATE TABLE "StudentFeeAssignment" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "feeStructureId"   TEXT NOT NULL REFERENCES "FeeStructure"("id"),
  "termId"           TEXT NOT NULL REFERENCES "Term"("id"),
  "customDiscount"   JSONB NOT NULL DEFAULT '{}',
  "extraDiscounts"   JSONB NOT NULL DEFAULT '[]',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StudentFeeAssignment_organizationId_studentProfileId_feeStruc_key" ON "StudentFeeAssignment"("organizationId","studentProfileId","feeStructureId","termId");
CREATE INDEX "StudentFeeAssignment_organizationId_idx" ON "StudentFeeAssignment"("organizationId");
CREATE INDEX "StudentFeeAssignment_studentProfileId_idx" ON "StudentFeeAssignment"("studentProfileId");

CREATE TABLE "Discount" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "type"           "DiscountType" NOT NULL,
  "value"          DECIMAL(18,6) NOT NULL,
  "appliesTo"      JSONB NOT NULL DEFAULT '{}',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Discount_organizationId_code_key" ON "Discount"("organizationId","code");
CREATE INDEX "Discount_organizationId_idx" ON "Discount"("organizationId");

CREATE TABLE "Scholarship" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "code"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "type"             TEXT NOT NULL,
  "value"            DECIMAL(18,6) NOT NULL,
  "validFrom"        TIMESTAMP(3) NOT NULL,
  "validTo"          TIMESTAMP(3),
  "awardedBy"        TEXT,
  "notes"            TEXT,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"        TIMESTAMP(3)
);
CREATE INDEX "Scholarship_organizationId_idx" ON "Scholarship"("organizationId");
CREATE INDEX "Scholarship_studentProfileId_idx" ON "Scholarship"("studentProfileId");

CREATE TABLE "InstallmentPlan" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "termId"           TEXT NOT NULL REFERENCES "Term"("id"),
  "totalAmount"      DECIMAL(20,6) NOT NULL,
  "installments"     JSONB NOT NULL,
  "customFields"     JSONB NOT NULL DEFAULT '{}',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InstallmentPlan_organizationId_idx" ON "InstallmentPlan"("organizationId");
CREATE INDEX "InstallmentPlan_studentProfileId_idx" ON "InstallmentPlan"("studentProfileId");

CREATE TABLE "PenaltyRule" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "feeScheduleId"  TEXT NOT NULL REFERENCES "FeeSchedule"("id") ON DELETE CASCADE,
  "type"           TEXT NOT NULL,
  "value"          DECIMAL(18,6) NOT NULL,
  "graceDays"      INTEGER NOT NULL DEFAULT 7,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PenaltyRule_organizationId_idx" ON "PenaltyRule"("organizationId");

CREATE TABLE "PenaltyRun" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "runAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduleId"      TEXT NOT NULL,
  "totalAssessed"   DECIMAL(20,6) NOT NULL,
  "createdInvoices" JSONB NOT NULL DEFAULT '[]',
  "notes"           TEXT
);
CREATE INDEX "PenaltyRun_organizationId_idx" ON "PenaltyRun"("organizationId");
CREATE INDEX "PenaltyRun_scheduleId_idx" ON "PenaltyRun"("scheduleId");

-- ── Sprint 8: Communication ────────────────────────────────────────────────

CREATE TABLE "NotificationTemplate" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "channel"        "NotificationChannel" NOT NULL,
  "code"           TEXT NOT NULL,
  "subject"        TEXT,
  "body"           TEXT NOT NULL,
  "variables"      JSONB NOT NULL DEFAULT '[]',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "NotificationTemplate_organizationId_channel_code_key" ON "NotificationTemplate"("organizationId","channel","code");
CREATE INDEX "NotificationTemplate_organizationId_idx" ON "NotificationTemplate"("organizationId");

CREATE TABLE "Notification" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "recipientType"     TEXT NOT NULL,
  "recipientId"       TEXT NOT NULL,
  "channel"           "NotificationChannel" NOT NULL,
  "templateCode"      TEXT,
  "payload"           JSONB NOT NULL DEFAULT '{}',
  "status"            "NotificationStatus" NOT NULL DEFAULT 'queued',
  "sentAt"            TIMESTAMP(3),
  "providerMessageId" TEXT,
  "error"             TEXT,
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");
CREATE INDEX "Notification_status_idx" ON "Notification"("status");
CREATE INDEX "Notification_recipientType_recipientId_idx" ON "Notification"("recipientType","recipientId");

CREATE TABLE "MessageThread" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "participantIds" JSONB NOT NULL DEFAULT '[]',
  "subject"        TEXT,
  "lastMessageAt"  TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MessageThread_organizationId_idx" ON "MessageThread"("organizationId");

CREATE TABLE "Message" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "threadId"       TEXT NOT NULL REFERENCES "MessageThread"("id") ON DELETE CASCADE,
  "senderId"       TEXT NOT NULL REFERENCES "StaffProfile"("id"),
  "body"           TEXT NOT NULL,
  "attachments"    JSONB NOT NULL DEFAULT '[]',
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readBy"         JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX "Message_organizationId_idx" ON "Message"("organizationId");
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");

-- ── Sprint 9: Library + Transport ──────────────────────────────────────────

CREATE TABLE "BookMetadata" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "author"         TEXT,
  "isbn"           TEXT,
  "publisher"      TEXT,
  "edition"        TEXT,
  "category"       TEXT NOT NULL DEFAULT 'textbook',
  "shelfLocation"  TEXT,
  "totalCopies"    INTEGER NOT NULL DEFAULT 1,
  "customFields"   JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "BookMetadata_productId_key" ON "BookMetadata"("productId");
CREATE INDEX "BookMetadata_organizationId_idx" ON "BookMetadata"("organizationId");
CREATE INDEX "BookMetadata_isbn_idx" ON "BookMetadata"("isbn");

CREATE TABLE "BookCopy" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "bookMetadataId" TEXT NOT NULL REFERENCES "BookMetadata"("id") ON DELETE CASCADE,
  "copyNumber"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'available',
  "condition"      TEXT NOT NULL DEFAULT 'good',
  "acquiredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "customFields"   JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX "BookCopy_organizationId_bookMetadataId_copyNumber_key" ON "BookCopy"("organizationId","bookMetadataId","copyNumber");
CREATE INDEX "BookCopy_organizationId_idx" ON "BookCopy"("organizationId");
CREATE INDEX "BookCopy_status_idx" ON "BookCopy"("status");

CREATE TABLE "Borrowing" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "bookMetadataId"   TEXT NOT NULL REFERENCES "BookMetadata"("id"),
  "bookCopyId"       TEXT NOT NULL REFERENCES "BookCopy"("id"),
  "studentProfileId" TEXT,
  "staffProfileId"   TEXT,
  "borrowedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"            TIMESTAMP(3) NOT NULL,
  "returnedAt"       TIMESTAMP(3),
  "status"           TEXT NOT NULL DEFAULT 'borrowed',
  "fineAmount"       DECIMAL(18,6) NOT NULL DEFAULT 0,
  "fineInvoiceId"    TEXT,
  "notes"            TEXT
);
CREATE INDEX "Borrowing_organizationId_idx" ON "Borrowing"("organizationId");
CREATE INDEX "Borrowing_studentProfileId_idx" ON "Borrowing"("studentProfileId");
CREATE INDEX "Borrowing_status_idx" ON "Borrowing"("status");
CREATE INDEX "Borrowing_dueAt_idx" ON "Borrowing"("dueAt");

CREATE TABLE "Vehicle" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "plateNumber"     TEXT NOT NULL,
  "capacity"        INTEGER NOT NULL DEFAULT 14,
  "type"            TEXT NOT NULL DEFAULT 'bus',
  "driverPartnerId" TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "customFields"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Vehicle_organizationId_code_key" ON "Vehicle"("organizationId","code");
CREATE INDEX "Vehicle_organizationId_idx" ON "Vehicle"("organizationId");
CREATE INDEX "Vehicle_plateNumber_idx" ON "Vehicle"("plateNumber");

CREATE TABLE "Route" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "monthlyFee"     DECIMAL(18,6) NOT NULL DEFAULT 0,
  "feeProductId"   TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Route_organizationId_name_key" ON "Route"("organizationId","name");
CREATE INDEX "Route_organizationId_idx" ON "Route"("organizationId");

CREATE TABLE "Stop" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "routeId"        TEXT NOT NULL REFERENCES "Route"("id") ON DELETE CASCADE,
  "name"           TEXT NOT NULL,
  "order"          INTEGER NOT NULL DEFAULT 1,
  "pickupTime"     TEXT,
  "dropoffTime"    TEXT,
  "feeOverride"    DECIMAL(18,6),
  "location"       JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Stop_organizationId_routeId_name_key" ON "Stop"("organizationId","routeId","name");
CREATE INDEX "Stop_organizationId_idx" ON "Stop"("organizationId");

CREATE TABLE "RouteAssignment" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "routeId"        TEXT NOT NULL REFERENCES "Route"("id") ON DELETE CASCADE,
  "vehicleId"      TEXT NOT NULL REFERENCES "Vehicle"("id"),
  "dayOfWeek"      INTEGER NOT NULL,
  "pickupTime"     TEXT,
  "dropoffTime"    TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "RouteAssignment_organizationId_routeId_vehicleId_dayOfWeek_key" ON "RouteAssignment"("organizationId","routeId","vehicleId","dayOfWeek");
CREATE INDEX "RouteAssignment_organizationId_idx" ON "RouteAssignment"("organizationId");

CREATE TABLE "StudentTransportAssignment" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id") ON DELETE CASCADE,
  "routeId"          TEXT NOT NULL REFERENCES "Route"("id"),
  "stopId"           TEXT NOT NULL REFERENCES "Stop"("id"),
  "termId"           TEXT,
  "startDate"        TIMESTAMP(3) NOT NULL,
  "endDate"          TIMESTAMP(3),
  "monthlyFee"       DECIMAL(18,6) NOT NULL DEFAULT 0,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StudentTransportAssignment_organizationId_idx" ON "StudentTransportAssignment"("organizationId");
CREATE INDEX "StudentTransportAssignment_studentProfileId_idx" ON "StudentTransportAssignment"("studentProfileId");

-- ── Sprint 10: Hostel + Cafeteria ─────────────────────────────────────────

CREATE TABLE "Dormitory" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "gender"          TEXT NOT NULL DEFAULT 'mixed',
  "capacity"        INTEGER NOT NULL DEFAULT 40,
  "wardenPartnerId" TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Dormitory_organizationId_name_key" ON "Dormitory"("organizationId","name");
CREATE INDEX "Dormitory_organizationId_idx" ON "Dormitory"("organizationId");

CREATE TABLE "Room" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "dormitoryId"    TEXT NOT NULL REFERENCES "Dormitory"("id") ON DELETE CASCADE,
  "number"         TEXT NOT NULL,
  "type"           TEXT NOT NULL DEFAULT 'double',
  "capacity"       INTEGER NOT NULL DEFAULT 2,
  "monthlyFee"     DECIMAL(18,6) NOT NULL DEFAULT 0,
  "feeProductId"   TEXT,
  "customFields"   JSONB NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Room_organizationId_dormitoryId_number_key" ON "Room"("organizationId","dormitoryId","number");
CREATE INDEX "Room_organizationId_idx" ON "Room"("organizationId");

CREATE TABLE "Bed" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "roomId"         TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE,
  "number"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'available',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Bed_organizationId_roomId_number_key" ON "Bed"("organizationId","roomId","number");
CREATE INDEX "Bed_organizationId_idx" ON "Bed"("organizationId");
CREATE INDEX "Bed_status_idx" ON "Bed"("status");

CREATE TABLE "HostelAllocation" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "bedId"            TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL REFERENCES "StudentProfile"("id"),
  "termId"           TEXT,
  "startDate"        TIMESTAMP(3) NOT NULL,
  "endDate"          TIMESTAMP(3),
  "checkOutDate"     TIMESTAMP(3),
  "status"           TEXT NOT NULL DEFAULT 'active',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HostelAllocation_bedId_key" ON "HostelAllocation"("bedId");
CREATE INDEX "HostelAllocation_organizationId_idx" ON "HostelAllocation"("organizationId");
CREATE INDEX "HostelAllocation_studentProfileId_idx" ON "HostelAllocation"("studentProfileId");

CREATE TABLE "MealPlan" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "type"           TEXT NOT NULL DEFAULT 'full',
  "feeProductId"   TEXT,
  "pricePerTerm"   DECIMAL(18,6) NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX "MealPlan_organizationId_name_key" ON "MealPlan"("organizationId","name");
CREATE INDEX "MealPlan_organizationId_idx" ON "MealPlan"("organizationId");

CREATE TABLE "MealAccount" (
  "id"               TEXT PRIMARY KEY,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "mealPlanId"       TEXT NOT NULL REFERENCES "MealPlan"("id"),
  "balance"          DECIMAL(20,6) NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MealAccount_studentProfileId_key" ON "MealAccount"("studentProfileId");
CREATE INDEX "MealAccount_organizationId_idx" ON "MealAccount"("organizationId");

CREATE TABLE "MealPurchase" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "mealAccountId"  TEXT NOT NULL REFERENCES "MealAccount"("id") ON DELETE CASCADE,
  "amount"         DECIMAL(18,6) NOT NULL,
  "description"    TEXT,
  "paymentId"      TEXT,
  "purchasedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MealPurchase_organizationId_idx" ON "MealPurchase"("organizationId");
CREATE INDEX "MealPurchase_mealAccountId_idx" ON "MealPurchase"("mealAccountId");

-- ── Sprint 11: Reports ────────────────────────────────────────────────────

CREATE TABLE "SchoolDashboardCache" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "asOf"           TIMESTAMP(3) NOT NULL,
  "payload"        JSONB NOT NULL,
  "builtAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SchoolDashboardCache_organizationId_kind_asOf_key" ON "SchoolDashboardCache"("organizationId","kind","asOf");
CREATE INDEX "SchoolDashboardCache_organizationId_asOf_idx" ON "SchoolDashboardCache"("organizationId","asOf");