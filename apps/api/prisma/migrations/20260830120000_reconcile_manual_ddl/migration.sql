-- Reconciliation: fold every hand-run DDL change back into migration history.
--
-- Between 2026-08-25 and 2026-08-30 several schema changes were applied to the
-- working database with psql scripts (prisma/ddl-*.sql, prisma/manual/*.sql)
-- instead of migrations. schema.prisma was updated to match, so the code and
-- the working database agreed -- but `prisma migrate deploy` into an empty
-- database produced a schema the code could not run against. That is invisible
-- until a second environment is provisioned, which is exactly when it is most
-- expensive to discover.
--
-- This migration is the difference, generated with:
--
--   prisma migrate diff --from-url <db-with-all-108-migrations-applied> \
--                       --to-schema-datamodel prisma/schema.prisma --script
--
-- so it is the schema's own account of what was missing, not a hand transcript
-- of the DDL scripts. It is non-destructive: 12 CREATE TABLE, 5 CREATE TYPE,
-- 53 ALTER TABLE (additive), 64 index creations, and 3 DROP INDEX that are
-- immediately recreated with different definitions. No table, column or data is
-- removed.
--
-- ON AN EXISTING DATABASE that already received the hand-run DDL (i.e. the
-- current working database), do NOT run this -- the objects are already there.
-- Record it as applied instead:
--
--   npx prisma migrate resolve --applied 20260830120000_reconcile_manual_ddl
--
-- Fresh environments get it through `prisma migrate deploy` like any other.
--
-- The superseded scripts are kept under prisma/superseded-ddl/ for provenance.

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('academic', 'behavior', 'facilities', 'staff_conduct', 'communication', 'fees', 'transport', 'meals', 'safety', 'other');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('open', 'in_progress', 'awaiting_response', 'resolved', 'closed', 'escalated');

-- CreateEnum
CREATE TYPE "ComplaintPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('completed', 'missed', 'voicemail', 'scheduled', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudentStatus" ADD VALUE 'applicant';
ALTER TYPE "StudentStatus" ADD VALUE 'graduated';
ALTER TYPE "StudentStatus" ADD VALUE 'deceased';
ALTER TYPE "StudentStatus" ADD VALUE 'archived';

-- DropForeignKey
ALTER TABLE "AttendanceStatusConfig" DROP CONSTRAINT "AttendanceStatusConfig_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_incomeHeadId_fkey";

-- DropIndex
DROP INDEX "AdmissionApplication_admissionCycleId_idx";

-- DropIndex
DROP INDEX "AdmissionApplication_org_class_idx";

-- DropIndex
DROP INDEX "OfferLetter_status_expiresAt_idx";

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "address" TEXT,
ADD COLUMN     "entryStatus" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "residenceType" TEXT;

-- AlterTable
ALTER TABLE "HrCertification" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "HrEmployee" ADD COLUMN     "partnerId" TEXT;

-- AlterTable
ALTER TABLE "HrPosition" ADD COLUMN     "gradeId" TEXT;

-- AlterTable
ALTER TABLE "HrQualification" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedBy" TEXT;

-- AlterTable
ALTER TABLE "Income" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "incomeDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "IncomeHead" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LessonPlanObjective" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MealMenuItem" ADD COLUMN     "posMenuItemId" TEXT;

-- AlterTable
ALTER TABLE "MessageDelivery" ADD COLUMN     "broadcastId" TEXT,
ADD COLUMN     "broadcastRecipientId" TEXT,
ADD COLUMN     "costMicros" BIGINT,
ADD COLUMN     "fallbackOfDeliveryId" TEXT,
ADD COLUMN     "fallbackPolicy" JSONB,
ADD COLUMN     "segments" INTEGER;

-- AlterTable
ALTER TABLE "ModLessonAttempt" ALTER COLUMN "seen" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "classTeacherId" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "studentCategoryId" TEXT;

-- AlterTable
ALTER TABLE "WaiverCategory" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "updatedBy" TEXT,
ALTER COLUMN "value" DROP DEFAULT,
ALTER COLUMN "appliesTo" DROP NOT NULL;

-- CreateTable
CREATE TABLE "HrSkill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeSkill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiency" TEXT NOT NULL DEFAULT 'intermediate',
    "yearsExperience" DECIMAL(5,2),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrEmployeeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrExperience" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "title" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "referenceName" TEXT,
    "referenceContact" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "type" TEXT,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrEmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessagingConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'all',
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'opted_out',
    "source" TEXT NOT NULL DEFAULT 'inbound_keyword',
    "reason" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "MessagingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageBroadcast" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "templateKey" TEXT,
    "audience" JSONB NOT NULL,
    "channelPolicy" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "materializedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,
    "unreachableCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedSegments" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "address" TEXT,
    "userId" TEXT,
    "studentProfileId" TEXT,
    "studentName" TEXT,
    "className" TEXT,
    "relationship" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerId" TEXT,
    "messageId" TEXT,
    "deliveryId" TEXT,
    "suppressionReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "preferredName" TEXT,
    "relationship" TEXT,
    "phone" TEXT,
    "alternativePhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "authorizedPickup" BOOLEAN NOT NULL DEFAULT false,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nationality" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nationality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT,
    "category" "ComplaintCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'open',
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'medium',
    "assignedToId" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneCall" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "subject" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "durationSec" INTEGER,
    "status" "CallStatus" NOT NULL DEFAULT 'completed',
    "callAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrSkill_organizationId_deletedAt_idx" ON "HrSkill"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrSkill_organizationId_code_key" ON "HrSkill"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrEmployeeSkill_organizationId_employeeId_deletedAt_idx" ON "HrEmployeeSkill"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrEmployeeSkill_organizationId_skillId_idx" ON "HrEmployeeSkill"("organizationId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeSkill_organizationId_employeeId_skillId_key" ON "HrEmployeeSkill"("organizationId", "employeeId", "skillId");

-- CreateIndex
CREATE INDEX "HrExperience_organizationId_employeeId_deletedAt_idx" ON "HrExperience"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrEmployeeDocument_organizationId_employeeId_deletedAt_idx" ON "HrEmployeeDocument"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrEmployeeDocument_organizationId_expiresAt_idx" ON "HrEmployeeDocument"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "MessagingConsent_organizationId_address_idx" ON "MessagingConsent"("organizationId", "address");

-- CreateIndex
CREATE INDEX "MessagingConsent_organizationId_status_channel_idx" ON "MessagingConsent"("organizationId", "status", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "MessagingConsent_organizationId_channel_address_key" ON "MessagingConsent"("organizationId", "channel", "address");

-- CreateIndex
CREATE INDEX "MessageBroadcast_organizationId_status_scheduledAt_idx" ON "MessageBroadcast"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MessageBroadcast_organizationId_createdAt_idx" ON "MessageBroadcast"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageBroadcast_status_scheduledAt_idx" ON "MessageBroadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_organizationId_broadcastId_status_idx" ON "BroadcastRecipient"("organizationId", "broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_messageId_idx" ON "BroadcastRecipient"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_dedupeKey_key" ON "BroadcastRecipient"("broadcastId", "dedupeKey");

-- CreateIndex
CREATE INDEX "EmergencyContact_organizationId_idx" ON "EmergencyContact"("organizationId");

-- CreateIndex
CREATE INDEX "EmergencyContact_studentProfileId_idx" ON "EmergencyContact"("studentProfileId");

-- CreateIndex
CREATE INDEX "Nationality_organizationId_isActive_idx" ON "Nationality"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Nationality_organizationId_name_key" ON "Nationality"("organizationId", "name");

-- CreateIndex
CREATE INDEX "StudentCategory_organizationId_idx" ON "StudentCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentCategory_organizationId_name_key" ON "StudentCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Complaint_organizationId_idx" ON "Complaint"("organizationId");

-- CreateIndex
CREATE INDEX "Complaint_partnerId_idx" ON "Complaint"("partnerId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_category_idx" ON "Complaint"("category");

-- CreateIndex
CREATE INDEX "PhoneCall_organizationId_idx" ON "PhoneCall"("organizationId");

-- CreateIndex
CREATE INDEX "PhoneCall_partnerId_idx" ON "PhoneCall"("partnerId");

-- CreateIndex
CREATE INDEX "PhoneCall_callAt_idx" ON "PhoneCall"("callAt");

-- CreateIndex
CREATE INDEX "PhoneCall_direction_idx" ON "PhoneCall"("direction");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionRequirement_organizationId_admissionCycleId_classI_key" ON "AdmissionRequirement"("organizationId", "admissionCycleId", "classId", "gate", "code");

-- CreateIndex
CREATE INDEX "HrApplicant_organizationId_vacancyId_deletedAt_idx" ON "HrApplicant"("organizationId", "vacancyId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrCertification_organizationId_employeeId_deletedAt_idx" ON "HrCertification"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrContract_organizationId_employeeId_deletedAt_idx" ON "HrContract"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrContract_organizationId_contractNumber_key" ON "HrContract"("organizationId", "contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployee_partnerId_key" ON "HrEmployee"("partnerId");

-- CreateIndex
CREATE INDEX "HrEmployeeAuditTrail_organizationId_employeeId_idx" ON "HrEmployeeAuditTrail"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "HrEmploymentAction_organizationId_employeeId_idx" ON "HrEmploymentAction"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "HrInterview_organizationId_applicantId_deletedAt_idx" ON "HrInterview"("organizationId", "applicantId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrJobGrade_organizationId_deletedAt_idx" ON "HrJobGrade"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrJobGrade_organizationId_code_key" ON "HrJobGrade"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrOffboarding_organizationId_employeeId_deletedAt_idx" ON "HrOffboarding"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrOnboardingTask_organizationId_employeeId_deletedAt_idx" ON "HrOnboardingTask"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrQualification_organizationId_employeeId_deletedAt_idx" ON "HrQualification"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrSalaryChange_organizationId_employeeId_idx" ON "HrSalaryChange"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "HrSalaryStructure_organizationId_deletedAt_idx" ON "HrSalaryStructure"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrSalaryStructure_organizationId_gradeId_componentId_key" ON "HrSalaryStructure"("organizationId", "gradeId", "componentId");

-- CreateIndex
CREATE INDEX "HrStatutoryConfig_organizationId_deletedAt_idx" ON "HrStatutoryConfig"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrStatutoryConfig_organizationId_code_effectiveFrom_key" ON "HrStatutoryConfig"("organizationId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "HrTraining_organizationId_deletedAt_idx" ON "HrTraining"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrTraining_organizationId_code_key" ON "HrTraining"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrTrainingEnrollment_organizationId_trainingId_deletedAt_idx" ON "HrTrainingEnrollment"("organizationId", "trainingId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrTrainingEnrollment_organizationId_employeeId_deletedAt_idx" ON "HrTrainingEnrollment"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrVacancy_organizationId_deletedAt_idx" ON "HrVacancy"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrVacancy_organizationId_code_key" ON "HrVacancy"("organizationId", "code");

-- CreateIndex
CREATE INDEX "LessonPlanObjective_organizationId_idx" ON "LessonPlanObjective"("organizationId");

-- CreateIndex
CREATE INDEX "MealMenuItem_posMenuItemId_idx" ON "MealMenuItem"("posMenuItemId");

-- CreateIndex
CREATE INDEX "MessageDelivery_broadcastId_status_idx" ON "MessageDelivery"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "MessageDelivery_broadcastRecipientId_idx" ON "MessageDelivery"("broadcastRecipientId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_externalReference_idx" ON "Payment"("organizationId", "externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_externalReferenceType_externalRefere_key" ON "Payment"("organizationId", "externalReferenceType", "externalReference", "direction");

-- CreateIndex
CREATE INDEX "Section_classTeacherId_idx" ON "Section"("classTeacherId");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_incomeHeadId_fkey" FOREIGN KEY ("incomeHeadId") REFERENCES "IncomeHead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPosition" ADD CONSTRAINT "HrPosition_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "HrJobGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryStructure" ADD CONSTRAINT "HrSalaryStructure_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "HrJobGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryStructure" ADD CONSTRAINT "HrSalaryStructure_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "HrPayrollComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryChange" ADD CONSTRAINT "HrSalaryChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryChange" ADD CONSTRAINT "HrSalaryChange_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmploymentAction" ADD CONSTRAINT "HrEmploymentAction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrContract" ADD CONSTRAINT "HrContract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrContract" ADD CONSTRAINT "HrContract_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOnboardingTask" ADD CONSTRAINT "HrOnboardingTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOffboarding" ADD CONSTRAINT "HrOffboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrApplicant" ADD CONSTRAINT "HrApplicant_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "HrVacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrApplicant" ADD CONSTRAINT "HrApplicant_hiredEmployeeId_fkey" FOREIGN KEY ("hiredEmployeeId") REFERENCES "HrEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrApplicant" ADD CONSTRAINT "HrApplicant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrInterview" ADD CONSTRAINT "HrInterview_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "HrApplicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrQualification" ADD CONSTRAINT "HrQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrQualification" ADD CONSTRAINT "HrQualification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCertification" ADD CONSTRAINT "HrCertification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrCertification" ADD CONSTRAINT "HrCertification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTrainingEnrollment" ADD CONSTRAINT "HrTrainingEnrollment_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "HrTraining"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTrainingEnrollment" ADD CONSTRAINT "HrTrainingEnrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeAuditTrail" ADD CONSTRAINT "HrEmployeeAuditTrail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeSkill" ADD CONSTRAINT "HrEmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeSkill" ADD CONSTRAINT "HrEmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "HrSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrExperience" ADD CONSTRAINT "HrExperience_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrExperience" ADD CONSTRAINT "HrExperience_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "MessageBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_classTeacherId_fkey" FOREIGN KEY ("classTeacherId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_studentCategoryId_fkey" FOREIGN KEY ("studentCategoryId") REFERENCES "StudentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_substituteTeacherId_fkey" FOREIGN KEY ("substituteTeacherId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrowing" ADD CONSTRAINT "Borrowing_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCall" ADD CONSTRAINT "PhoneCall_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "AdmissionApplication_org_status_year_idx" RENAME TO "AdmissionApplication_organizationId_status_academicYearId_idx";

-- RenameIndex
ALTER INDEX "AdmissionCapacity_organizationId_admissionCycleId_classId_sec_i" RENAME TO "AdmissionCapacity_organizationId_admissionCycleId_classId_s_key";

-- RenameIndex
ALTER INDEX "AdmissionEnquiry_org_status_idx" RENAME TO "AdmissionEnquiry_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "AdmissionReviewerAssignment_org_reviewer_status_idx" RENAME TO "AdmissionReviewerAssignment_organizationId_reviewerId_statu_idx";

-- RenameIndex
ALTER INDEX "BillingRunItem_run_student_key" RENAME TO "BillingRunItem_billingRunId_studentProfileId_key";

-- RenameIndex
ALTER INDEX "Campus_org_isMain_idx" RENAME TO "Campus_organizationId_isMain_idx";

-- RenameIndex
ALTER INDEX "CourseOffering_org_ay_term_subj_class_section_key" RENAME TO "CourseOffering_organizationId_academicYearId_termId_subject_key";

-- RenameIndex
ALTER INDEX "CourseOfferingTeacher_co_teacher_key" RENAME TO "CourseOfferingTeacher_courseOfferingId_teacherPartnerId_key";

-- RenameIndex
ALTER INDEX "FeeAdjustment_org_code_key" RENAME TO "FeeAdjustment_organizationId_code_key";

-- RenameIndex
ALTER INDEX "FeeStructureVersion_structure_version_key" RENAME TO "FeeStructureVersion_feeStructureId_versionNo_key";

-- RenameIndex
ALTER INDEX "FinancialRemediationBatch_org_code_key" RENAME TO "FinancialRemediationBatch_organizationId_code_key";

-- RenameIndex
ALTER INDEX "LearningObjectiveProgress_student_lo_key" RENAME TO "LearningObjectiveProgress_studentProfileId_learningObjectiv_key";

-- RenameIndex
ALTER INDEX "LessonPlanResource_lp_lr_key" RENAME TO "LessonPlanResource_lessonPlanId_learningResourceId_key";

-- RenameIndex
ALTER INDEX "MobileMoneyRequest_org_status_idx" RENAME TO "MobileMoneyRequest_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "PaymentAllocation_org_status_idx" RENAME TO "PaymentAllocation_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "PaymentAllocationReversal_allocation_key" RENAME TO "PaymentAllocationReversal_paymentAllocationId_key";

-- RenameIndex
ALTER INDEX "PaymentImportBatch_org_provider_period_hash_key" RENAME TO "PaymentImportBatch_organizationId_provider_statementPeriod__key";

-- RenameIndex
ALTER INDEX "PaymentImportRow_org_externalRef_key" RENAME TO "PaymentImportRow_organizationId_externalRef_key";

-- RenameIndex
ALTER INDEX "PortalIdentity_userId_subjectType_studentProfileId_guardianC_ke" RENAME TO "PortalIdentity_userId_subjectType_studentProfileId_guardian_key";

-- RenameIndex
ALTER INDEX "SchoolFeeInvoice_org_number_key" RENAME TO "SchoolFeeInvoice_organizationId_invoiceNumber_key";

-- RenameIndex
ALTER INDEX "SchoolFeeInvoice_org_student_term_version_key" RENAME TO "SchoolFeeInvoice_organizationId_studentProfileId_termId_fee_key";

-- RenameIndex
ALTER INDEX "StudentCourseProgress_student_co_key" RENAME TO "StudentCourseProgress_studentProfileId_courseOfferingId_key";

-- RenameIndex
ALTER INDEX "StudentOptionalFee_organizationId_studentProfileId_termId_fe_ke" RENAME TO "StudentOptionalFee_organizationId_studentProfileId_termId_f_key";

-- RenameIndex
ALTER INDEX "TermFinancialClose_org_term_key" RENAME TO "TermFinancialClose_organizationId_termId_key";

