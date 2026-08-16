-- P1 advanced school finance: sponsorships, waivers, fee credits.
-- Surgically additive; safe to re-run (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS "Sponsorship" (
  "id" text NOT NULL,
  "organizationId" text NOT NULL,
  "sponsorId" text NOT NULL,
  "studentProfileId" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "capAmount" decimal(18,4),
  "validFrom" timestamp(3) NOT NULL,
  "validTo" timestamp(3),
  "isActive" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Waiver" (
  "id" text NOT NULL,
  "organizationId" text NOT NULL,
  "studentProfileId" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "amount" decimal(18,4) NOT NULL,
  "reason" text,
  "documentId" text,
  "applied" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Waiver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FeeCredit" (
  "id" text NOT NULL,
  "organizationId" text NOT NULL,
  "studentProfileId" text NOT NULL,
  "code" text NOT NULL,
  "amount" decimal(18,4) NOT NULL,
  "remaining" decimal(18,4) NOT NULL,
  "source" text NOT NULL DEFAULT 'advance',
  "sourcePaymentId" text,
  "sourceDocumentId" text,
  "expiresAt" timestamp(3),
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeCredit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Sponsorship_organizationId_code_key" ON "Sponsorship" ("organizationId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "Waiver_organizationId_code_key" ON "Waiver" ("organizationId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "FeeCredit_organizationId_code_key" ON "FeeCredit" ("organizationId", "code");
CREATE INDEX IF NOT EXISTS "Sponsorship_organizationId_idx" ON "Sponsorship" ("organizationId");
CREATE INDEX IF NOT EXISTS "Waiver_organizationId_idx" ON "Waiver" ("organizationId");
CREATE INDEX IF NOT EXISTS "FeeCredit_organizationId_idx" ON "FeeCredit" ("organizationId");

ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sponsorship" ADD CONSTRAINT "Sponsorship_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Waiver" ADD CONSTRAINT "Waiver_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeeCredit" ADD CONSTRAINT "FeeCredit_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeeCredit" ADD CONSTRAINT "FeeCredit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
