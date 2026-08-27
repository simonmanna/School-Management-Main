-- Configurable admission workflow + capacity ledger correction.
--
-- 1. AdmissionWorkflow: per-organization configuration of WHICH business stages a
--    school requires (Application → Evaluation → Decision → Offer → Applicant
--    Acceptance → Enrollment). Stage config is JSON, owned and validated by
--    admission-workflow.schema.ts. Eligibility conditions are NOT configurable.
-- 2. AdmissionCycle.workflowId: the workflow applied to applications created in that
--    cycle FROM NOW ON. Reassigning it never alters existing applications.
-- 3. AdmissionApplication.workflowId (provenance) + workflowSnapshot (AUTHORITATIVE,
--    frozen at creation). Editing a workflow can never change the required stages of
--    an application that already exists. NULL resolves to the built-in Standard
--    workflow in the registry, reproducing the pre-workflow behaviour exactly — so
--    there is deliberately NO backfill of existing applications.
-- 4. AdmissionStatusHistory.skippedStages: which stages a REAL transition was
--    authorized to bypass. Nothing is synthesized — a skipped stage writes no status
--    row and no artifact, so `offer_issued` always means an offer really was issued.
-- 5. AdmissionCapacity.claimedSeats: shipped in schema.prisma by 1b7c282 with no
--    migration (schema drift). Added here idempotently, then BACKFILLED, because it
--    is now the single seat ledger: the enroll guard was `claimedSeats < capacity -
--    reserved - occupied`, which double-counted every committed seat (it lands in
--    both `occupied` and `claimedSeats`), so a capacity-2 class admitted only one
--    student sequentially.
--
-- Idempotent throughout: safe on a database where 1b7c282's column was already
-- pushed by hand.

-- 5a. claimedSeats column (drift repair)
ALTER TABLE "AdmissionCapacity" ADD COLUMN IF NOT EXISTS "claimedSeats" INTEGER NOT NULL DEFAULT 0;

-- 1. AdmissionWorkflow
CREATE TABLE IF NOT EXISTS "AdmissionWorkflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "presetKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionWorkflow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdmissionWorkflow_organizationId_active_idx"
  ON "AdmissionWorkflow"("organizationId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "AdmissionWorkflow_organizationId_name_key"
  ON "AdmissionWorkflow"("organizationId", "name");

-- 2. Cycle assignment
ALTER TABLE "AdmissionCycle" ADD COLUMN IF NOT EXISTS "workflowId" TEXT;
CREATE INDEX IF NOT EXISTS "AdmissionCycle_workflowId_idx" ON "AdmissionCycle"("workflowId");

-- 3. Application provenance + immutable snapshot
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "workflowId" TEXT;
ALTER TABLE "AdmissionApplication" ADD COLUMN IF NOT EXISTS "workflowSnapshot" JSONB;
CREATE INDEX IF NOT EXISTS "AdmissionApplication_workflowId_idx"
  ON "AdmissionApplication"("workflowId");

-- 4. Skipped-stage provenance on real transitions
ALTER TABLE "AdmissionStatusHistory"
  ADD COLUMN IF NOT EXISTS "skippedStages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Foreign keys (guarded: ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdmissionCycle_workflowId_fkey') THEN
    ALTER TABLE "AdmissionCycle"
      ADD CONSTRAINT "AdmissionCycle_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "AdmissionWorkflow"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdmissionApplication_workflowId_fkey') THEN
    ALTER TABLE "AdmissionApplication"
      ADD CONSTRAINT "AdmissionApplication_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "AdmissionWorkflow"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5b. Backfill the seat ledger from committed enrollments, so legacy seats are
-- counted exactly once. Mirrors countOccupied(): active enrollments for the capacity
-- row's class/section/stream, scoped to the cycle's academic year, mapping the
-- '__none__' sentinel back to NULL (real enrollments store NULL for absent
-- section/stream). Runs unconditionally: on a fresh database every count is 0.
UPDATE "AdmissionCapacity" ac
   SET "claimedSeats" = sub.cnt
  FROM (
        SELECT ac2.id,
               (SELECT COUNT(*)
                  FROM "Enrollment" e
                  JOIN "Term" t ON t.id = e."termId"
                  JOIN "AdmissionCycle" cy ON cy.id = ac2."admissionCycleId"
                 WHERE e."organizationId" = ac2."organizationId"
                   AND e."classId"        = ac2."classId"
                   AND e."status"         = 'enrolled'
                   AND e."endedAt" IS NULL
                   AND t."academicYearId" = cy."academicYearId"
                   AND e."sectionId" IS NOT DISTINCT FROM NULLIF(ac2."sectionId", '__none__')
                   AND e."streamId"  IS NOT DISTINCT FROM NULLIF(ac2."streamId",  '__none__')
               )::int AS cnt
          FROM "AdmissionCapacity" ac2
       ) sub
 WHERE ac.id = sub.id
   AND ac."claimedSeats" IS DISTINCT FROM sub.cnt;
