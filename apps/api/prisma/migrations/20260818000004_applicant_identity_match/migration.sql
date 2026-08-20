-- Phase-2 identity/deduplication layer.
CREATE TABLE "ApplicantIdentityMatch" (
  "id"            TEXT    NOT NULL,
  "organizationId" TEXT   NOT NULL,
  "applicationId" TEXT    NOT NULL,
  "candidateType" TEXT    NOT NULL,
  "candidateId"   TEXT    NOT NULL,
  "candidateName" TEXT    NOT NULL,
  "matchMethod"   TEXT    NOT NULL,
  "matchScore"    INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT    NOT NULL DEFAULT 'open',
  "reviewedById"  TEXT,
  "reviewedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApplicantIdentityMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicantIdentityMatch_organizationId_idx" ON "ApplicantIdentityMatch" ("organizationId");
CREATE INDEX "ApplicantIdentityMatch_applicationId_idx" ON "ApplicantIdentityMatch" ("applicationId");
CREATE INDEX "ApplicantIdentityMatch_candidateId_idx" ON "ApplicantIdentityMatch" ("candidateId");

-- FK: each match belongs to an application (one application -> many matches).
ALTER TABLE "ApplicantIdentityMatch"
  ADD CONSTRAINT "ApplicantIdentityMatch_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
