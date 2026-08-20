-- Phase 3-5 admissions domain extension.
-- AdmissionCycle
CREATE TABLE "AdmissionCycle" (
  "id"             TEXT    NOT NULL,
  "organizationId" TEXT    NOT NULL,
  "academicYearId" TEXT    NOT NULL,
  "name"           TEXT    NOT NULL,
  "opensAt"        TIMESTAMP(3),
  "closesAt"       TIMESTAMP(3),
  "status"         TEXT    NOT NULL DEFAULT 'open',
  "customFields"   JSONB   NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdmissionCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdmissionCycle_organizationId_academicYearId_name_key" ON "AdmissionCycle" ("organizationId","academicYearId","name");
CREATE INDEX "AdmissionCycle_organizationId_idx" ON "AdmissionCycle" ("organizationId");
CREATE INDEX "AdmissionCycle_academicYearId_idx" ON "AdmissionCycle" ("academicYearId");
ALTER TABLE "AdmissionCycle" ADD CONSTRAINT "AdmissionCycle_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AdmissionCapacity
CREATE TABLE "AdmissionCapacity" (
  "id"               TEXT    NOT NULL,
  "organizationId"   TEXT    NOT NULL,
  "admissionCycleId" TEXT    NOT NULL,
  "classId"          TEXT    NOT NULL,
  "sectionId"        TEXT,
  "streamId"         TEXT,
  "campusId"         TEXT,
  "capacity"         INTEGER NOT NULL DEFAULT 0,
  "reservedCapacity" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AdmissionCapacity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdmissionCapacity_organizationId_admissionCycleId_classId_sec_idx" ON "AdmissionCapacity" ("organizationId","admissionCycleId","classId","sectionId","streamId");
CREATE INDEX "AdmissionCapacity_organizationId_idx" ON "AdmissionCapacity" ("organizationId");
CREATE INDEX "AdmissionCapacity_admissionCycleId_idx" ON "AdmissionCapacity" ("admissionCycleId");
CREATE INDEX "AdmissionCapacity_classId_idx" ON "AdmissionCapacity" ("classId");
ALTER TABLE "AdmissionCapacity" ADD CONSTRAINT "AdmissionCapacity_admissionCycleId_fkey" FOREIGN KEY ("admissionCycleId") REFERENCES "AdmissionCycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdmissionCriteriaSet
CREATE TABLE "AdmissionCriteriaSet" (
  "id"               TEXT    NOT NULL,
  "organizationId"   TEXT    NOT NULL,
  "admissionCycleId" TEXT    NOT NULL,
  "name"             TEXT    NOT NULL,
  "classId"          TEXT,
  "isDefault"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionCriteriaSet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdmissionCriteriaSet_organizationId_idx" ON "AdmissionCriteriaSet" ("organizationId");
CREATE INDEX "AdmissionCriteriaSet_admissionCycleId_idx" ON "AdmissionCriteriaSet" ("admissionCycleId");
ALTER TABLE "AdmissionCriteriaSet" ADD CONSTRAINT "AdmissionCriteriaSet_admissionCycleId_fkey" FOREIGN KEY ("admissionCycleId") REFERENCES "AdmissionCycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdmissionCriterion
CREATE TABLE "AdmissionCriterion" (
  "id"            TEXT    NOT NULL,
  "organizationId" TEXT    NOT NULL,
  "criteriaSetId" TEXT    NOT NULL,
  "name"          TEXT    NOT NULL,
  "weight"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxScore"      DOUBLE PRECISION NOT NULL DEFAULT 100,
  "required"      BOOLEAN NOT NULL DEFAULT false,
  "passMark"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "AdmissionCriterion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdmissionCriterion_organizationId_idx" ON "AdmissionCriterion" ("organizationId");
CREATE INDEX "AdmissionCriterion_criteriaSetId_idx" ON "AdmissionCriterion" ("criteriaSetId");
ALTER TABLE "AdmissionCriterion" ADD CONSTRAINT "AdmissionCriterion_criteriaSetId_fkey" FOREIGN KEY ("criteriaSetId") REFERENCES "AdmissionCriteriaSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdmissionDecision
CREATE TABLE "AdmissionDecision" (
  "id"             TEXT    NOT NULL,
  "organizationId" TEXT    NOT NULL,
  "applicationId"  TEXT    NOT NULL,
  "decision"       TEXT    NOT NULL,
  "totalScore"     DOUBLE PRECISION,
  "breakdown"      JSONB,
  "decidedById"    TEXT,
  "reason"         TEXT,
  "decidedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdmissionDecision_applicationId_key" ON "AdmissionDecision" ("applicationId");
CREATE INDEX "AdmissionDecision_organizationId_idx" ON "AdmissionDecision" ("organizationId");
CREATE INDEX "AdmissionDecision_applicationId_idx" ON "AdmissionDecision" ("applicationId");
ALTER TABLE "AdmissionDecision" ADD CONSTRAINT "AdmissionDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdmissionApplication additions
ALTER TABLE "AdmissionApplication" ADD COLUMN "admissionCycleId" TEXT;
ALTER TABLE "AdmissionApplication" ADD COLUMN "screenedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "interviewedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "examScheduledAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "scoredAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "offerIssuedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "offerAcceptedAt" TIMESTAMP(3);
ALTER TABLE "AdmissionApplication" ADD COLUMN "enrolledAt" TIMESTAMP(3);
CREATE INDEX "AdmissionApplication_admissionCycleId_idx" ON "AdmissionApplication" ("admissionCycleId");
ALTER TABLE "AdmissionApplication" ADD CONSTRAINT "AdmissionApplication_admissionCycleId_fkey" FOREIGN KEY ("admissionCycleId") REFERENCES "AdmissionCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OfferLetter additions
ALTER TABLE "OfferLetter" ADD COLUMN "viewedAt" TIMESTAMP(3);
ALTER TABLE "OfferLetter" ADD COLUMN "declinedAt" TIMESTAMP(3);
ALTER TABLE "OfferLetter" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "OfferLetter" ADD COLUMN "conditions" TEXT;
ALTER TABLE "OfferLetter" ADD COLUMN "depositPaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OfferLetter" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- ApplicantScore addition
ALTER TABLE "ApplicantScore" ADD COLUMN "breakdown" JSONB;
