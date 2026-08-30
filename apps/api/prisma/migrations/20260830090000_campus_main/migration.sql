-- Campus "main" flag: exactly one main campus per organization, by default the
-- earliest-created campus. Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS;
-- the UPDATE only sets main where none exists yet).

ALTER TABLE "Campus" ADD COLUMN IF NOT EXISTS "isMain" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: make the earliest (by createdAt) non-deleted campus per org the main
-- one, only where that org does not already have a main campus.
UPDATE "Campus" AS c
SET "isMain" = true
WHERE c."deletedAt" IS NULL
  AND c."isMain" = false
  AND c."id" = (
    SELECT "id"
    FROM "Campus" AS c2
    WHERE c2."organizationId" = c."organizationId"
      AND c2."deletedAt" IS NULL
    ORDER BY c2."createdAt" ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Campus" AS existing
    WHERE existing."organizationId" = c."organizationId"
      AND existing."isMain" = true
      AND existing."deletedAt" IS NULL
  );

CREATE INDEX IF NOT EXISTS "Campus_org_isMain_idx" ON "Campus" ("organizationId", "isMain");
