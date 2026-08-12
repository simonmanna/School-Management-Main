-- Configurable table zones: PosTableZone catalog + PosTable.zone enum → key.
-- Order matters:
--   1. Convert PosTable.zone enum → TEXT in place FIRST (Postgres cannot
--      create a table named "PosTableZone" while the enum TYPE of the same
--      name exists — a table creates an associated composite type).
--   2. Drop the old enum, then create + seed the catalog.
--   3. Re-point legacy 'custom' rows at their new zone rows, drop the
--      obsolete column.
-- The whole file is one transaction; a failure rolls back everything.

-- Convert PosTable.zone in place: enum → TEXT, preserving existing values.
ALTER TABLE "PosTable" ALTER COLUMN "zone" SET DATA TYPE TEXT USING "zone"::text;
ALTER TABLE "PosTable" ALTER COLUMN "zone" SET DEFAULT 'indoor';

-- Free the type name so the catalog table can take it.
DROP TYPE "PosTableZone";

-- CreateTable
CREATE TABLE "PosTableZone" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#10b981',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PosTableZone_pkey" PRIMARY KEY ("id")
);

-- Seed the 6 default zones for EVERY existing organization. Keys keep the
-- legacy enum names so PosTable.zone values map 1:1.
INSERT INTO "PosTableZone" (id, "organizationId", key, name, "sortOrder", color, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", v.key, v.name, v.sort, v.color, true, now(), now()
FROM "Organization" o
CROSS JOIN (VALUES
  ('indoor'::text, 'Indoor'::text, 1, '#10b981'),
  ('outdoor', 'Outdoor', 2, '#f59e0b'),
  ('terrace', 'Terrace', 3, '#fb923c'),
  ('vip', 'VIP', 4, '#a855f7'),
  ('garden', 'Garden', 5, '#22c55e'),
  ('bar', 'Bar', 6, '#ec4899')
) AS v(key, name, sort, color);

-- Migrate the customZone free-text hack into real zone rows: one zone per
-- distinct (org, customZone) value; every table that used it is re-pointed.
WITH custom_source AS (
  SELECT DISTINCT ON ("organizationId", lower("customZone"))
    "organizationId" AS org_id,
    "customZone" AS zone_name,
    'custom_' || replace(gen_random_uuid()::text, '-', '') AS new_key
  FROM "PosTable"
  WHERE zone = 'custom' AND "customZone" IS NOT NULL AND btrim("customZone") <> ''
),
inserted AS (
  INSERT INTO "PosTableZone" (id, "organizationId", key, name, "sortOrder", color, active, "createdAt", "updatedAt")
  SELECT gen_random_uuid(), org_id, new_key, zone_name, 100, '#0ea5e9', true, now(), now()
  FROM custom_source
  RETURNING "organizationId", key, name
)
UPDATE "PosTable" t
SET zone = i.key
FROM inserted i
WHERE t."organizationId" = i."organizationId"
  AND t.zone = 'custom'
  AND lower(t."customZone") = lower(i.name);

-- Drop the obsolete column (values now live in PosTableZone rows).
ALTER TABLE "PosTable" DROP COLUMN "customZone";

-- CreateIndex
CREATE INDEX "PosTableZone_organizationId_deletedAt_idx" ON "PosTableZone"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "PosTableZone_organizationId_sortOrder_idx" ON "PosTableZone"("organizationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PosTableZone_organizationId_key_key" ON "PosTableZone"("organizationId", "key");
-- NOTE: PosTable_organizationId_zone_idx already exists (zone column was
-- converted in place, so its index survived) — no need to recreate it.
