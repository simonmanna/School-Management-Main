-- Admissions P0 hardening.
--
-- 1) ApplicationDocument.required / rejectionReason
--    `enrollmentEligibility()` filtered application documents on `d.required`,
--    but the column never existed — so the required-document gate matched an
--    empty set and never blocked an enrollment. `rejectionReason` lets a reviewer
--    say WHY a document was rejected so the applicant knows what to replace.
ALTER TABLE "ApplicationDocument"
  ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- 2) Duplicate-application constraint.
--    create() guarded duplicates with a findFirst-then-create inside a READ
--    COMMITTED transaction, so two concurrent submissions both saw no row and
--    both inserted. This partial unique index makes the invariant the database's
--    job. Names are folded to lower(trim(...)) to match the service's own
--    normalisation, and soft-deleted applications are excluded so a withdrawn
--    application does not block a genuine re-application.
--
--    NULL applicantDob does not collide under a plain unique index, so the DOB is
--    coalesced to a sentinel date to make "same name, no DOB, same year" collide
--    exactly as the service intends.
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionApplication_dedupe_key"
  ON "AdmissionApplication" (
    "organizationId",
    "academicYearId",
    lower(btrim("applicantFirstName")),
    lower(btrim("applicantLastName")),
    (COALESCE("applicantDob", '0001-01-01'::timestamp))
  )
  WHERE "deletedAt" IS NULL;

-- 3) Pipeline / worklist indexes.
--    The admissions worklist filters by status within an academic year, and the
--    pipeline metrics group by status. Neither was backed by a composite index.
CREATE INDEX IF NOT EXISTS "AdmissionApplication_org_status_year_idx"
  ON "AdmissionApplication" ("organizationId", "status", "academicYearId");

CREATE INDEX IF NOT EXISTS "AdmissionApplication_org_class_idx"
  ON "AdmissionApplication" ("organizationId", "applyingForClassId");

-- 4) Offer expiry sweep index — the expiry job scans issued/viewed offers past
--    their expiresAt.
CREATE INDEX IF NOT EXISTS "OfferLetter_status_expiresAt_idx"
  ON "OfferLetter" ("status", "expiresAt");
