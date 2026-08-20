-- Admissions Phase 1 — core application workflow.

-- New lifecycle states.
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'submitted';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'documents_pending' AFTER 'under_review';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'offer_declined' AFTER 'offer_accepted';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'offer_expired' AFTER 'offer_declined';

-- Application: portal/source metadata + encrypted NIN.
ALTER TABLE "AdmissionApplication"
  ADD COLUMN IF NOT EXISTS "submittedByPortal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceOfEnquiry" TEXT,
  ADD COLUMN IF NOT EXISTS "siblingOfStudentId" TEXT,
  ADD COLUMN IF NOT EXISTS "ninCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "ninIv" TEXT,
  ADD COLUMN IF NOT EXISTS "ninTag" TEXT;

-- Structured guardians captured on the application.
CREATE TABLE IF NOT EXISTS "AdmissionGuardian" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "relationship" TEXT NOT NULL,
  "phone" TEXT,
  "altPhone" TEXT,
  "email" TEXT,
  "occupation" TEXT,
  "address" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isEmergency" BOOLEAN NOT NULL DEFAULT false,
  "financiallyResponsible" BOOLEAN NOT NULL DEFAULT false,
  "contactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionGuardian_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionGuardian_applicationId_fkey" FOREIGN KEY ("applicationId")
    REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdmissionGuardian_organizationId_idx" ON "AdmissionGuardian"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionGuardian_applicationId_idx" ON "AdmissionGuardian"("applicationId");

-- Append-only per-application status timeline.
CREATE TABLE IF NOT EXISTS "AdmissionStatusHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "changedById" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionStatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId")
    REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AdmissionStatusHistory_organizationId_idx" ON "AdmissionStatusHistory"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionStatusHistory_applicationId_idx" ON "AdmissionStatusHistory"("applicationId");

-- Per-cycle requirements (documents / fields / fee) with a submit|enroll gate.
CREATE TABLE IF NOT EXISTS "AdmissionRequirement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "admissionCycleId" TEXT,
  "classId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'document',
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "gate" TEXT NOT NULL DEFAULT 'submit',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdmissionRequirement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionRequirement_org_cycle_class_gate_code_key"
  ON "AdmissionRequirement"("organizationId", COALESCE("admissionCycleId",''), COALESCE("classId",''), "gate", "code");
CREATE INDEX IF NOT EXISTS "AdmissionRequirement_organizationId_idx" ON "AdmissionRequirement"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionRequirement_admissionCycleId_idx" ON "AdmissionRequirement"("admissionCycleId");

-- Reviewer assignments (admissions committee).
CREATE TABLE IF NOT EXISTS "AdmissionReviewerAssignment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'reviewer',
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "recommendation" TEXT,
  "score" DOUBLE PRECISION,
  "comments" TEXT,
  "assignedById" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AdmissionReviewerAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionReviewerAssignment_applicationId_fkey" FOREIGN KEY ("applicationId")
    REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionReviewerAssignment_applicationId_reviewerId_key"
  ON "AdmissionReviewerAssignment"("applicationId", "reviewerId");
CREATE INDEX IF NOT EXISTS "AdmissionReviewerAssignment_organizationId_idx" ON "AdmissionReviewerAssignment"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionReviewerAssignment_applicationId_idx" ON "AdmissionReviewerAssignment"("applicationId");
CREATE INDEX IF NOT EXISTS "AdmissionReviewerAssignment_org_reviewer_status_idx"
  ON "AdmissionReviewerAssignment"("organizationId", "reviewerId", "status");

-- Applicant portal magic-link tokens.
CREATE TABLE IF NOT EXISTS "AdmissionPortalToken" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionPortalToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionPortalToken_applicationId_fkey" FOREIGN KEY ("applicationId")
    REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionPortalToken_tokenHash_key" ON "AdmissionPortalToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AdmissionPortalToken_organizationId_idx" ON "AdmissionPortalToken"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionPortalToken_applicationId_idx" ON "AdmissionPortalToken"("applicationId");

-- Offer letter templates.
CREATE TABLE IF NOT EXISTS "AdmissionOfferTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "validityDays" INTEGER NOT NULL DEFAULT 14,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "AdmissionOfferTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdmissionOfferTemplate_organizationId_idx" ON "AdmissionOfferTemplate"("organizationId");

-- Enquiries / leads.
CREATE TABLE IF NOT EXISTS "AdmissionEnquiry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "academicYearId" TEXT,
  "applicantName" TEXT NOT NULL,
  "guardianName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "interestedClassId" TEXT,
  "source" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "notes" TEXT,
  "convertedApplicationId" TEXT,
  "assignedToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "AdmissionEnquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdmissionEnquiry_organizationId_idx" ON "AdmissionEnquiry"("organizationId");
CREATE INDEX IF NOT EXISTS "AdmissionEnquiry_org_status_idx" ON "AdmissionEnquiry"("organizationId", "status");

-- FK for applyingForClassId (was a bare string; now referential).
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdmissionApplication_applyingForClassId_fkey') THEN
    ALTER TABLE "AdmissionApplication"
      ADD CONSTRAINT "AdmissionApplication_applyingForClassId_fkey"
      FOREIGN KEY ("applyingForClassId") REFERENCES "SchoolClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;
