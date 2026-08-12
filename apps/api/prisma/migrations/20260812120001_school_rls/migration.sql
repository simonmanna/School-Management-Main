-- School vertical — tenant-isolation policies (companion to 20260812120000).
--
-- Same shape as every other org-scoped table: create the policy and FORCE ROW
-- LEVEL SECURITY, but deliberately do NOT `ENABLE ROW LEVEL SECURITY`. In this
-- deployment RLS is left inert and isolation is enforced by the app-side Prisma
-- tenancy extension (app.org_id is only set inside interactive transactions, so
-- a table with RLS *enabled* would reject the app's ordinary standalone
-- queries). The policy lies dormant until an operator turns RLS on org-wide via
-- `pnpm rls:setup-role`.
--
-- All 67 school tables carry a non-null organizationId. CurriculumSubject did
-- not in the source fork — it was the one join table left unscoped, which would
-- have made it the only school table this policy could not cover. The column
-- was added in the companion migration.
--
-- The matching app-side registration lives in ORG_SCOPED
-- (apps/api/src/kernel/prisma/tenancy.extension.ts) and is verified against the
-- schema by tenancy-registration.spec.ts.

DO $$
DECLARE
    t text;
    school_tables text[] := ARRAY[
        'AcademicTranscript',
        'AcademicYear',
        'AdmissionApplication',
        'Announcement',
        'ApplicationDocument',
        'Bed',
        'BookCopy',
        'BookMetadata',
        'Borrowing',
        'Campus',
        'Curriculum',
        'CurriculumSubject',
        'Department',
        'Discount',
        'Dormitory',
        'Enrollment',
        'EntranceExam',
        'Exam',
        'ExamSchedule',
        'ExamType',
        'FeeSchedule',
        'FeeStructure',
        'GradeEntry',
        'GradeLevel',
        'GradingScale',
        'HomeworkAssignment',
        'HomeworkSubmission',
        'HostelAllocation',
        'InstallmentPlan',
        'LearningResource',
        'LessonPlan',
        'MealAccount',
        'MealPlan',
        'MealPurchase',
        'MedicalRecord',
        'PenaltyAssessment',
        'PenaltyRule',
        'PenaltyRun',
        'Period',
        'Position',
        'ReportCard',
        'Room',
        'Route',
        'RouteAssignment',
        'Scholarship',
        'SchoolCalendarEvent',
        'SchoolClass',
        'SchoolDashboardCache',
        'SchoolProfile',
        'Section',
        'StaffAttendance',
        'StaffProfile',
        'StaffStatusHistory',
        'Stop',
        'StudentAttendance',
        'StudentDocument',
        'StudentFeeAssignment',
        'StudentGuardian',
        'StudentProfile',
        'StudentStatusHistory',
        'StudentTransportAssignment',
        'Subject',
        'TeacherAssignment',
        'Term',
        'TimetableSlot',
        'Vehicle',
        'WaitingList'
    ];
BEGIN
    FOREACH t IN ARRAY school_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
