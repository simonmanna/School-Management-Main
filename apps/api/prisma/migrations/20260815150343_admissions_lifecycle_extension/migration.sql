-- Admissions lifecycle extension (Application → Screening → Interview → Admission → Enrollment)
-- Adds: extended AdmissionStatus enum values, application fee fields, and the
-- Interview / ApplicantScore / AdmissionFee / OfferLetter tables.
-- Authored manually because `prisma migrate dev` refuses to run while the target
-- database has pre-existing drift (MealMenuItem.posMenuItemId) that would force a reset.

-- 1) Extend the AdmissionStatus enum with the new states.
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'screening';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'interview_scheduled';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'interviewed';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'scored';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'waitlisted';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'offer_issued';
ALTER TYPE "AdmissionStatus" ADD VALUE IF NOT EXISTS 'offer_accepted';

-- 2) Application fee fields on AdmissionApplication.
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "feeStatus" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "feeInvoiceId" TEXT;

-- 3) Interview
CREATE TABLE IF NOT EXISTS "Interview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewerId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "recommendation" TEXT,
    "panelNotes" TEXT,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- 4) ApplicantScore
CREATE TABLE IF NOT EXISTS "ApplicantScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "examScore" DECIMAL(6,2),
    "interviewScore" DECIMAL(6,2),
    "documentScore" DECIMAL(6,2),
    "totalScore" DECIMAL(6,2),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantScore_pkey" PRIMARY KEY ("id")
);

-- 5) AdmissionFee
CREATE TABLE IF NOT EXISTS "AdmissionFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "invoiceId" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "AdmissionFee_pkey" PRIMARY KEY ("id")
);

-- 6) OfferLetter
CREATE TABLE IF NOT EXISTS "OfferLetter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "templateId" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "OfferLetter_pkey" PRIMARY KEY ("id")
);

-- 7) Unique constraints + foreign keys + indexes
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_key" UNIQUE ("applicationId");
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Interview_organizationId_idx" ON "Interview"("organizationId");
CREATE INDEX IF NOT EXISTS "Interview_applicationId_idx" ON "Interview"("applicationId");

ALTER TABLE "ApplicantScore" ADD CONSTRAINT "ApplicantScore_applicationId_key" UNIQUE ("applicationId");
ALTER TABLE "ApplicantScore" ADD CONSTRAINT "ApplicantScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ApplicantScore_organizationId_idx" ON "ApplicantScore"("organizationId");

ALTER TABLE "AdmissionFee" ADD CONSTRAINT "AdmissionFee_applicationId_key" UNIQUE ("applicationId");
ALTER TABLE "AdmissionFee" ADD CONSTRAINT "AdmissionFee_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AdmissionFee_organizationId_idx" ON "AdmissionFee"("organizationId");

ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_applicationId_key" UNIQUE ("applicationId");
ALTER TABLE "OfferLetter" ADD CONSTRAINT "OfferLetter_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "OfferLetter_organizationId_idx" ON "OfferLetter"("organizationId");
CREATE INDEX IF NOT EXISTS "OfferLetter_applicationId_idx" ON "OfferLetter"("applicationId");
