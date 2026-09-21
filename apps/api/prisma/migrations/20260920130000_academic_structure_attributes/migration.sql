-- Academic structure: configuration attributes (Phase 1, ADR-028 / ADR-029 / ADR-030).
--
-- Purely ADDITIVE. Nothing is dropped, nothing changes meaning. Every statement
-- is guarded so a re-run is a no-op.
--
-- What this adds, and why:
--
--   * `code` on GradeLevel / SchoolClass / Section — a stable identifier that
--     survives renaming. CSV import and integrations resolve on codes; display
--     names change ("P4" becomes "Primary 4") and resolving on them silently
--     mis-files learners.
--   * `isActive` everywhere — historical enrollment makes deletion unsafe, so
--     deactivation is the replacement (brief para 41). Inactive rows stay
--     queryable; only pickers filter them out.
--   * `displayOrder` on SchoolClass / Section — academic order is not
--     alphabetical order. "P10" sorts before "P2" by name, and
--     North/South/East/West has no alphabetical meaning at all.
--   * `AcademicYear.status` — `isCurrent` says which year the school is working
--     in; it cannot say whether last year is closed or next year is still being
--     planned.
--   * `GradeLevel.nextGradeLevelId` / `isTerminal` — configurable progression.
--     Promotion currently derives the next grade from `order` plus alphabetical
--     class name, which guesses.
--   * `SchoolClass.allowsStreams` — not every class is subdivided (brief para 10).
--   * `capacity` relaxed to NULL-able on SchoolClass and Section — NULL means
--     unlimited, a real configuration rather than a missing value (brief para 11).
--   * `SchoolProfile.terminology` — per-school display vocabulary (brief para 2).
--
-- The three unique indexes on `code` are created AFTER the backfill below, and
-- deliberately allow NULL: Postgres treats NULLs as distinct, so a row whose code
-- could not be derived does not block the index. `code` is therefore left
-- nullable rather than forced NOT NULL, so a failed derivation shows up as a null
-- to be fixed rather than as a migration that refuses to apply against a tenant's
-- data. There are 944 organizations in this database; one bad row must not stop
-- the other 943.

-- ── enum ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "AcademicYearStatus" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── columns ──────────────────────────────────────────────────────────────────
ALTER TABLE "AcademicYear"
  ADD COLUMN IF NOT EXISTS "closedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedById" TEXT,
  ADD COLUMN IF NOT EXISTS "status"     "AcademicYearStatus" NOT NULL DEFAULT 'PLANNING';

ALTER TABLE "GradeLevel"
  ADD COLUMN IF NOT EXISTS "code"             TEXT,
  ADD COLUMN IF NOT EXISTS "description"      TEXT,
  ADD COLUMN IF NOT EXISTS "isActive"         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "isTerminal"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nextGradeLevelId" TEXT;

ALTER TABLE "SchoolClass"
  ADD COLUMN IF NOT EXISTS "allowsStreams" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "code"          TEXT,
  ADD COLUMN IF NOT EXISTS "description"   TEXT,
  ADD COLUMN IF NOT EXISTS "displayOrder"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isActive"      BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SchoolClass" ALTER COLUMN "capacity" DROP NOT NULL;

ALTER TABLE "Section"
  ADD COLUMN IF NOT EXISTS "code"         TEXT,
  ADD COLUMN IF NOT EXISTS "description"  TEXT,
  ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isActive"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Section" ALTER COLUMN "capacity" DROP NOT NULL;

ALTER TABLE "SchoolProfile"
  ADD COLUMN IF NOT EXISTS "terminology" JSONB NOT NULL DEFAULT '{}';

-- ── backfill: codes ──────────────────────────────────────────────────────────
-- Derive from the display name: strip everything that is not alphanumeric and
-- upper-case it, so "Primary 4" and "P.4" both yield a usable code. Collisions
-- are resolved with a numeric suffix rather than left to the unique index.
--
-- Soft-deleted rows are INCLUDED in the numbering window on purpose. Excluding
-- them lets a live row take a code a deleted row already holds, and the unique
-- index does not filter on `deletedAt`.
--
-- Guarded by `WHERE "code" IS NULL`, so re-running changes nothing and a code an
-- administrator has since edited by hand is never overwritten.

WITH derived AS (
  SELECT id,
         upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')) AS base,
         row_number() OVER (
           PARTITION BY "organizationId", upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
           ORDER BY "order", id
         ) AS rn
  FROM "GradeLevel"
  WHERE "code" IS NULL
)
UPDATE "GradeLevel" g
   SET "code" = CASE WHEN d.rn = 1 THEN d.base ELSE d.base || '-' || d.rn END
  FROM derived d
 WHERE g.id = d.id AND d.base <> '';

WITH derived AS (
  SELECT id,
         upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')) AS base,
         row_number() OVER (
           PARTITION BY "organizationId", upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
           ORDER BY "createdAt", id
         ) AS rn
  FROM "SchoolClass"
  WHERE "code" IS NULL
)
UPDATE "SchoolClass" c
   SET "code" = CASE WHEN d.rn = 1 THEN d.base ELSE d.base || '-' || d.rn END
  FROM derived d
 WHERE c.id = d.id AND d.base <> '';

WITH derived AS (
  SELECT id,
         upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g')) AS base,
         row_number() OVER (
           PARTITION BY "organizationId", "classId", upper(regexp_replace(name, '[^A-Za-z0-9]+', '', 'g'))
           ORDER BY "createdAt", id
         ) AS rn
  FROM "Section"
  WHERE "code" IS NULL
)
UPDATE "Section" s
   SET "code" = CASE WHEN d.rn = 1 THEN d.base ELSE d.base || '-' || d.rn END
  FROM derived d
 WHERE s.id = d.id AND d.base <> '';

-- ── backfill: academic year lifecycle ────────────────────────────────────────
-- `status` defaults to PLANNING, which is wrong for every row that already
-- exists. Derive it from what the data already says: the current year is ACTIVE,
-- a year that has ended is CLOSED, a year that has not started is PLANNING, and
-- anything spanning today without being flagged current is ACTIVE.
--
-- A deliberate omission: no `UNIQUE ... WHERE isCurrent` index is created here.
-- An organization that already has two current years would make such an index
-- fail to build, aborting the whole migration for every other tenant. That is a
-- data problem to be found and fixed by hand, not one a migration should decide.
UPDATE "AcademicYear"
   SET "status" = CASE
         WHEN "isCurrent"          THEN 'ACTIVE'::"AcademicYearStatus"
         WHEN "endDate"   < now()  THEN 'CLOSED'::"AcademicYearStatus"
         WHEN "startDate" > now()  THEN 'PLANNING'::"AcademicYearStatus"
         ELSE 'ACTIVE'::"AcademicYearStatus"
       END
 WHERE "status" = 'PLANNING' AND ("isCurrent" OR "endDate" < now() OR "startDate" <= now());

UPDATE "AcademicYear"
   SET "closedAt" = COALESCE("closedAt", "endDate")
 WHERE "status" = 'CLOSED' AND "closedAt" IS NULL;

-- ── backfill: class display order ────────────────────────────────────────────
-- Seed from the grade ladder so classes render in academic order out of the box
-- (P1 before P2 before P10) instead of all sharing 0 and falling back to
-- alphabetical. Administrators can reorder afterwards.
UPDATE "SchoolClass" c
   SET "displayOrder" = g."order"
  FROM "GradeLevel" g
 WHERE c."gradeLevelId" = g.id AND c."displayOrder" = 0 AND g."order" <> 0;

-- ── backfill: grade progression ──────────────────────────────────────────────
-- Seed `nextGradeLevelId` from the existing `order` ladder: the next grade is the
-- one with the smallest order greater than this one, within the same
-- organization. This reproduces exactly what promotion infers today, which is why
-- it is a safe starting point — the difference is that it is now visible,
-- editable, and no longer re-derived on every promotion.
--
-- The highest-ordered grade in each organization becomes `isTerminal`, so
-- promotion offers COMPLETED rather than promoting a P7 leaver into nothing.
WITH ladder AS (
  SELECT id, "organizationId",
         lead(id) OVER (PARTITION BY "organizationId" ORDER BY "order", name) AS next_id
  FROM "GradeLevel"
  WHERE "deletedAt" IS NULL
)
UPDATE "GradeLevel" g
   SET "nextGradeLevelId" = l.next_id
  FROM ladder l
 WHERE g.id = l.id AND l.next_id IS NOT NULL AND g."nextGradeLevelId" IS NULL;

UPDATE "GradeLevel" g
   SET "isTerminal" = true
 WHERE g."deletedAt" IS NULL
   AND g."nextGradeLevelId" IS NULL
   AND g."isTerminal" = false;

-- ── indexes and constraints ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "GradeLevel_nextGradeLevelId_idx"
  ON "GradeLevel"("nextGradeLevelId");

CREATE INDEX IF NOT EXISTS "SchoolClass_organizationId_isActive_displayOrder_idx"
  ON "SchoolClass"("organizationId", "isActive", "displayOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "GradeLevel_organizationId_code_key"
  ON "GradeLevel"("organizationId", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "SchoolClass_organizationId_code_key"
  ON "SchoolClass"("organizationId", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "Section_organizationId_classId_code_key"
  ON "Section"("organizationId", "classId", "code");

DO $$ BEGIN
  ALTER TABLE "GradeLevel"
    ADD CONSTRAINT "GradeLevel_nextGradeLevelId_fkey"
    FOREIGN KEY ("nextGradeLevelId") REFERENCES "GradeLevel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
