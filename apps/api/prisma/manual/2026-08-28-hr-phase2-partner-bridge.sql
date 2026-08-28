-- HR Phase 2: the Partner bridge.
--
-- Adds `HrEmployee.partnerId` (unique, nullable) so the school-side
-- `StaffProfile` and the HR employment record resolve to the SAME person via
-- the shared master-data Partner (ADR-008). `StaffProfile.partnerId` already
-- exists, so one column is enough — the join is derivable from both sides.
--
-- The column stays nullable indefinitely: an org may run HR without the school
-- vertical, and unmatched rows are the reconciliation screen's job.

-- ── 1. Column + unique index + FK ────────────────────────────────────────────
ALTER TABLE "HrEmployee" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployee_partnerId_key" ON "HrEmployee"("partnerId");

DO $$ BEGIN
  ALTER TABLE "HrEmployee"
    ADD CONSTRAINT "HrEmployee_partnerId_fkey"
    FOREIGN KEY ("partnerId") REFERENCES "Partner"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Backfill — EXACT matches only, most-confident tier first ──────────────
-- Every tier is guarded by `partnerId IS NULL` so they compose and can be
-- re-run. A wrong link silently puts one employee's GL partner dimension on
-- another's payslip, so name similarity is deliberately NOT used.

-- Tier A: employeeCode == StaffProfile.employeeNo in the same org.
-- Both are human-assigned employee numbers, so this is the highest-yield rule.
-- The subquery must return exactly one row on each side, hence the
-- HAVING count(*) = 1 guards.
UPDATE "HrEmployee" e
SET "partnerId" = m."partnerId"
FROM (
  SELECT sp."organizationId", sp."employeeNo", MIN(sp."partnerId") AS "partnerId"
  FROM "StaffProfile" sp
  WHERE sp."deletedAt" IS NULL
  GROUP BY sp."organizationId", sp."employeeNo"
  HAVING count(*) = 1
) m
WHERE e."partnerId" IS NULL
  AND e."deletedAt" IS NULL
  AND e."organizationId" = m."organizationId"
  AND e."employeeCode" = m."employeeNo"
  -- never steal a Partner already claimed by another HrEmployee
  AND NOT EXISTS (SELECT 1 FROM "HrEmployee" x WHERE x."partnerId" = m."partnerId");

-- Tier B: the employee's linked User email matches exactly one employee Partner.
UPDATE "HrEmployee" e
SET "partnerId" = m."partnerId"
FROM (
  SELECT u."id" AS "userId", p."organizationId", MIN(p."id") AS "partnerId"
  FROM "User" u
  JOIN "Partner" p
    ON p."organizationId" = u."organizationId"
   AND lower(btrim(p."email")) = lower(btrim(u."email"))
  WHERE p."isEmployee" = true
    AND p."deletedAt" IS NULL
    AND u."deletedAt" IS NULL
    AND p."email" IS NOT NULL
    AND btrim(p."email") <> ''
  GROUP BY u."id", p."organizationId"
  HAVING count(*) = 1
) m
WHERE e."partnerId" IS NULL
  AND e."deletedAt" IS NULL
  AND e."userId" = m."userId"
  AND e."organizationId" = m."organizationId"
  AND NOT EXISTS (SELECT 1 FROM "HrEmployee" x WHERE x."partnerId" = m."partnerId");

-- Tier C: case-folded, trimmed email equality, unique on BOTH sides.
UPDATE "HrEmployee" e
SET "partnerId" = m."partnerId"
FROM (
  SELECT p."organizationId", lower(btrim(p."email")) AS "email", MIN(p."id") AS "partnerId"
  FROM "Partner" p
  WHERE p."isEmployee" = true
    AND p."deletedAt" IS NULL
    AND p."email" IS NOT NULL
    AND btrim(p."email") <> ''
  GROUP BY p."organizationId", lower(btrim(p."email"))
  HAVING count(*) = 1
) m
WHERE e."partnerId" IS NULL
  AND e."deletedAt" IS NULL
  AND e."organizationId" = m."organizationId"
  AND e."email" IS NOT NULL
  AND btrim(e."email") <> ''
  AND lower(btrim(e."email")) = m."email"
  AND NOT EXISTS (SELECT 1 FROM "HrEmployee" x WHERE x."partnerId" = m."partnerId")
  -- and the HR side must be unambiguous too
  AND NOT EXISTS (
    SELECT 1 FROM "HrEmployee" y
    WHERE y."organizationId" = e."organizationId"
      AND y."deletedAt" IS NULL
      AND y."id" <> e."id"
      AND lower(btrim(y."email")) = lower(btrim(e."email"))
  );
