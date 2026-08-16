-- AlterEnum
BEGIN;
CREATE TYPE "AdmissionStatus_new" AS ENUM ('submitted', 'under_review', 'screening', 'interview_scheduled', 'interviewed', 'scored', 'accepted', 'waitlisted', 'offer_issued', 'offer_accepted', 'rejected', 'enrolled', 'withdrawn');
ALTER TABLE "public"."AdmissionApplication" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AdmissionApplication" ALTER COLUMN "status" TYPE "AdmissionStatus_new" USING ("status"::text::"AdmissionStatus_new");
ALTER TYPE "AdmissionStatus" RENAME TO "AdmissionStatus_old";
ALTER TYPE "AdmissionStatus_new" RENAME TO "AdmissionStatus";
DROP TYPE "public"."AdmissionStatus_old";
ALTER TABLE "AdmissionApplication" ALTER COLUMN "status" SET DEFAULT 'submitted';
COMMIT;

-- DropIndex
DROP INDEX "Curriculum_organizationId_classId_academicYearId_name_key";

-- DropIndex
DROP INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key";

-- AlterTable
ALTER TABLE "Curriculum" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "parentVersionId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "DMSWorkflowLedger" DROP CONSTRAINT "DMSWorkflowLedger_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "DMSWorkflowLedger_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "streamId" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "currentStreamId" TEXT;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN     "subjectCategoryId" TEXT;

-- AlterTable
ALTER TABLE "TeacherAssignment" ADD COLUMN     "streamId" TEXT;

-- AlterTable
ALTER TABLE "Term" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'term';

-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN     "streamId" TEXT;

-- CreateTable
CREATE TABLE "SubjectCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SubjectCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 40,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "curriculumId" TEXT,
    "curriculumSubjectId" TEXT,
    "competencyId" TEXT,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "curriculumId" TEXT,
    "curriculumSubjectId" TEXT,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjective" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT,
    "topicId" TEXT,
    "description" TEXT NOT NULL,
    "bloomLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LearningObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonPlanObjective" (
    "id" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,

    CONSTRAINT "LessonPlanObjective_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectCategory_organizationId_idx" ON "SubjectCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectCategory_organizationId_code_key" ON "SubjectCategory"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Stream_organizationId_idx" ON "Stream"("organizationId");

-- CreateIndex
CREATE INDEX "Stream_classId_idx" ON "Stream"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_organizationId_classId_name_key" ON "Stream"("organizationId", "classId", "name");

-- CreateIndex
CREATE INDEX "EnrollmentHistory_organizationId_idx" ON "EnrollmentHistory"("organizationId");

-- CreateIndex
CREATE INDEX "EnrollmentHistory_enrollmentId_idx" ON "EnrollmentHistory"("enrollmentId");

-- CreateIndex
CREATE INDEX "Competency_organizationId_idx" ON "Competency"("organizationId");

-- CreateIndex
CREATE INDEX "Competency_subjectId_idx" ON "Competency"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_organizationId_code_key" ON "Competency"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Topic_organizationId_idx" ON "Topic"("organizationId");

-- CreateIndex
CREATE INDEX "Topic_curriculumId_idx" ON "Topic"("curriculumId");

-- CreateIndex
CREATE INDEX "Topic_curriculumSubjectId_idx" ON "Topic"("curriculumSubjectId");

-- CreateIndex
CREATE INDEX "Topic_competencyId_idx" ON "Topic"("competencyId");

-- CreateIndex
CREATE INDEX "Unit_organizationId_idx" ON "Unit"("organizationId");

-- CreateIndex
CREATE INDEX "Unit_curriculumId_idx" ON "Unit"("curriculumId");

-- CreateIndex
CREATE INDEX "Unit_curriculumSubjectId_idx" ON "Unit"("curriculumSubjectId");

-- CreateIndex
CREATE INDEX "Unit_topicId_idx" ON "Unit"("topicId");

-- CreateIndex
CREATE INDEX "LearningObjective_organizationId_idx" ON "LearningObjective"("organizationId");

-- CreateIndex
CREATE INDEX "LearningObjective_unitId_idx" ON "LearningObjective"("unitId");

-- CreateIndex
CREATE INDEX "LearningObjective_topicId_idx" ON "LearningObjective"("topicId");

-- CreateIndex
CREATE INDEX "LessonPlanObjective_learningObjectiveId_idx" ON "LessonPlanObjective"("learningObjectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonPlanObjective_lessonPlanId_learningObjectiveId_key" ON "LessonPlanObjective"("lessonPlanId", "learningObjectiveId");

-- CreateIndex
CREATE INDEX "Curriculum_parentVersionId_idx" ON "Curriculum"("parentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Curriculum_organizationId_classId_academicYearId_version_key" ON "Curriculum"("organizationId", "classId", "academicYearId", "version");

-- CreateIndex
CREATE INDEX "Enrollment_sectionId_idx" ON "Enrollment"("sectionId");

-- CreateIndex
CREATE INDEX "Enrollment_streamId_idx" ON "Enrollment"("streamId");

-- CreateIndex
CREATE INDEX "StudentProfile_currentStreamId_idx" ON "StudentProfile"("currentStreamId");

-- CreateIndex
CREATE INDEX "Subject_subjectCategoryId_idx" ON "Subject"("subjectCategoryId");

-- CreateIndex
CREATE INDEX "TeacherAssignment_streamId_idx" ON "TeacherAssignment"("streamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key" ON "TeacherAssignment"("organizationId", "teacherPartnerId", "subjectId", "classId", "sectionId", "streamId", "termId");

-- CreateIndex
CREATE INDEX "TimetableSlot_streamId_idx" ON "TimetableSlot"("streamId");

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_subjectCategoryId_fkey" FOREIGN KEY ("subjectCategoryId") REFERENCES "SubjectCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_currentStreamId_fkey" FOREIGN KEY ("currentStreamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentHistory" ADD CONSTRAINT "EnrollmentHistory_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Curriculum" ADD CONSTRAINT "Curriculum_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "Curriculum"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_curriculumSubjectId_fkey" FOREIGN KEY ("curriculumSubjectId") REFERENCES "CurriculumSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_curriculumSubjectId_fkey" FOREIGN KEY ("curriculumSubjectId") REFERENCES "CurriculumSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjective" ADD CONSTRAINT "LearningObjective_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjective" ADD CONSTRAINT "LearningObjective_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlanObjective" ADD CONSTRAINT "LessonPlanObjective_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlanObjective" ADD CONSTRAINT "LessonPlanObjective_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "LearningObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AcademicRoster_org_term_class_idx" RENAME TO "AcademicRoster_organizationId_termId_classId_idx";

-- RenameIndex
ALTER INDEX "AcademicRosterMember_roster_student_unique" RENAME TO "AcademicRosterMember_rosterId_studentProfileId_key";

-- RenameIndex
ALTER INDEX "Assessment_org_class_term_subject_idx" RENAME TO "Assessment_organizationId_classId_termId_subjectId_idx";

-- RenameIndex
ALTER INDEX "Assessment_origin_unique" RENAME TO "Assessment_organizationId_sourceType_sourceRef_key";

-- RenameIndex
ALTER INDEX "AssessmentComponent_org_examType_idx" RENAME TO "AssessmentComponent_organizationId_examTypeId_idx";

-- RenameIndex
ALTER INDEX "AssessmentPolicy_scope_idx" RENAME TO "AssessmentPolicy_organizationId_subjectId_classId_gradeLeve_idx";

-- RenameIndex
ALTER INDEX "AssessmentRubricScore_student_criterion_unique" RENAME TO "AssessmentRubricScore_studentAssessmentId_criterionId_key";

-- RenameIndex
ALTER INDEX "AssignmentSubmission_assignment_student_attempt_unique" RENAME TO "AssignmentSubmission_assignmentId_studentAssessmentId_attem_key";

-- RenameIndex
ALTER INDEX "Certificate_org_serial_unique" RENAME TO "Certificate_organizationId_serialNumber_key";

-- RenameIndex
ALTER INDEX "Certificate_org_student_idx" RENAME TO "Certificate_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "ExamRegistration_exam_student_unique" RENAME TO "ExamRegistration_examId_studentProfileId_key";

-- RenameIndex
ALTER INDEX "ExamRegistration_org_student_idx" RENAME TO "ExamRegistration_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "ExamVenue_org_name_unique" RENAME TO "ExamVenue_organizationId_name_key";

-- RenameIndex
ALTER INDEX "ExternalExamResult_org_student_idx" RENAME TO "ExternalExamResult_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "ExternalExamResult_org_student_level_year_unique" RENAME TO "ExternalExamResult_organizationId_studentProfileId_level_ye_key";

-- RenameIndex
ALTER INDEX "MarkAdjustment_studentAssessment_sequence_unique" RENAME TO "MarkAdjustment_studentAssessmentId_sequence_key";

-- RenameIndex
ALTER INDEX "MarkEntry_studentAssessment_round_unique" RENAME TO "MarkEntry_studentAssessmentId_round_key";

-- RenameIndex
ALTER INDEX "MealAttendance_organizationId_mealSessionId_studentProfileId_ke" RENAME TO "MealAttendance_organizationId_mealSessionId_studentProfileI_key";

-- RenameIndex
ALTER INDEX "PaperQuestion_paper_question_unique" RENAME TO "PaperQuestion_paperId_questionId_key";

-- RenameIndex
ALTER INDEX "QuestionBank_org_subject_idx" RENAME TO "QuestionBank_organizationId_subjectId_idx";

-- RenameIndex
ALTER INDEX "QuizAttempt_org_student_idx" RENAME TO "QuizAttempt_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "QuizResponse_attempt_question_unique" RENAME TO "QuizResponse_attemptId_questionId_key";

-- RenameIndex
ALTER INDEX "ResultProcessingRun_org_idem_unique" RENAME TO "ResultProcessingRun_organizationId_idempotencyKey_key";

-- RenameIndex
ALTER INDEX "ResultProcessingRun_org_term_idx" RENAME TO "ResultProcessingRun_organizationId_termId_idx";

-- RenameIndex
ALTER INDEX "ResultSet_org_term_scope_idx" RENAME TO "ResultSet_organizationId_termId_scopeType_scopeId_idx";

-- RenameIndex
ALTER INDEX "StudentAssessment_assessment_student_unique" RENAME TO "StudentAssessment_assessmentId_studentProfileId_key";

-- RenameIndex
ALTER INDEX "StudentAssessment_org_student_idx" RENAME TO "StudentAssessment_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "StudentAssessment_org_student_term_idx" RENAME TO "StudentAssessment_organizationId_studentProfileId_termId_idx";

-- RenameIndex
ALTER INDEX "StudentSubjectResult_org_student_idx" RENAME TO "StudentSubjectResult_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "StudentSubjectResult_set_student_subject_unique" RENAME TO "StudentSubjectResult_resultSetId_studentProfileId_subjectId_key";

-- RenameIndex
ALTER INDEX "StudentTermResult_org_student_idx" RENAME TO "StudentTermResult_organizationId_studentProfileId_idx";

-- RenameIndex
ALTER INDEX "StudentTermResult_set_student_unique" RENAME TO "StudentTermResult_resultSetId_studentProfileId_key";

