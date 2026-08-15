-- A6 certification: external (UNEB) results + issued certificates.

CREATE TYPE "CertificateType" AS ENUM ('completion', 'leaving', 'testimonial', 'merit', 'award');
CREATE TYPE "CertificateStatus" AS ENUM ('draft', 'issued', 'revoked', 'void');

CREATE TABLE "ExternalExamResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'UNEB',
    "level" TEXT NOT NULL,
    "indexNumber" TEXT,
    "year" INTEGER NOT NULL,
    "aggregate" INTEGER,
    "division" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "importedPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ExternalExamResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalExamSubjectResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalResultId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "mark" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalExamSubjectResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'issued',
    "serialNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE UNIQUE INDEX "ExternalExamResult_org_student_level_year_unique" ON "ExternalExamResult"("organizationId", "studentProfileId", "level", "year");
CREATE INDEX "ExternalExamResult_organizationId_idx" ON "ExternalExamResult"("organizationId");
CREATE INDEX "ExternalExamResult_org_student_idx" ON "ExternalExamResult"("organizationId", "studentProfileId");
CREATE INDEX "ExternalExamSubjectResult_organizationId_idx" ON "ExternalExamSubjectResult"("organizationId");
CREATE INDEX "ExternalExamSubjectResult_externalResultId_idx" ON "ExternalExamSubjectResult"("externalResultId");
CREATE UNIQUE INDEX "Certificate_org_serial_unique" ON "Certificate"("organizationId", "serialNumber");
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");
CREATE INDEX "Certificate_organizationId_idx" ON "Certificate"("organizationId");
CREATE INDEX "Certificate_org_student_idx" ON "Certificate"("organizationId", "studentProfileId");

-- Foreign keys
ALTER TABLE "ExternalExamSubjectResult" ADD CONSTRAINT "ExternalExamSubjectResult_externalResultId_fkey" FOREIGN KEY ("externalResultId") REFERENCES "ExternalExamResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (inert)
DO $$
DECLARE
    t text;
    a6_tables text[] := ARRAY['ExternalExamResult', 'ExternalExamSubjectResult', 'Certificate'];
BEGIN
    FOREACH t IN ARRAY a6_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));', t);
    END LOOP;
END $$;
