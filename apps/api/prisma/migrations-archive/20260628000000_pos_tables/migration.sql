-- POS Phase T1 — Tables Management (ADR-012).
--
-- Adds three operational tables:
--   PosTable             — physical seat (name, number, zone, geometry, status)
--   PosTableOrder        — live link between a table and an open sales_invoice
--   PosTableReservation  — booking (party size + time window) with lifecycle
--
-- Also adds `Document.tableId` as a denormalised hot-path cache so reporting
-- queries (utilization / revenue per table) can GROUP BY table without
-- joining PosTableOrder. The PosTableOrder row stays the source of truth.
--
-- Hard-delete is forbidden — PosTableOrder / PosTableReservation use
-- `onDelete: Restrict` so audit history survives. Tables are soft-archived
-- via `active=false`.

-- ---------------------------------------------------------------------------
-- 0. Extend AuditAction enum (needed for merge / clean / reserve)
-- ---------------------------------------------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'merge';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'clean';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'reserve';

-- ---------------------------------------------------------------------------
-- 1. Document.tableId denormalised cache
-- ---------------------------------------------------------------------------
ALTER TABLE "Document" ADD COLUMN "tableId" TEXT;
CREATE INDEX "Document_organizationId_tableId_idx" ON "Document" ("organizationId", "tableId");

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "PosTableStatus" AS ENUM (
  'available', 'occupied', 'reserved', 'dirty', 'out_of_service'
);

CREATE TYPE "PosTableShape" AS ENUM (
  'square', 'rectangle', 'circle'
);

CREATE TYPE "PosTableZone" AS ENUM (
  'indoor', 'outdoor', 'terrace', 'vip', 'garden', 'bar', 'custom'
);

CREATE TYPE "PosReservationStatus" AS ENUM (
  'pending', 'seated', 'completed', 'cancelled', 'no_show'
);

-- ---------------------------------------------------------------------------
-- 3. PosTable
-- ---------------------------------------------------------------------------
CREATE TABLE "PosTable" (
  id               UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  name             TEXT NOT NULL,
  number           INTEGER NOT NULL,
  seats            INTEGER NOT NULL DEFAULT 2,
  zone             "PosTableZone" NOT NULL DEFAULT 'indoor',
  "customZone"     TEXT,
  shape            "PosTableShape" NOT NULL DEFAULT 'square',
  "posX"           INTEGER NOT NULL DEFAULT 40,
  "posY"           INTEGER NOT NULL DEFAULT 40,
  width            INTEGER NOT NULL DEFAULT 120,
  height           INTEGER NOT NULL DEFAULT 120,
  status           "PosTableStatus" NOT NULL DEFAULT 'available',
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  "assignedWaiterId" TEXT,
  "mergedIntoId"   UUID,
  "mergedAt"       TIMESTAMP(3),
  "mergedById"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,

  CONSTRAINT "PosTable_pkey" PRIMARY KEY (id),
  CONSTRAINT "PosTable_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId")
    REFERENCES "PosTable"(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PosTable_organizationId_number_key"
  ON "PosTable" ("organizationId", number);
CREATE INDEX "PosTable_organizationId_idx"        ON "PosTable" ("organizationId");
CREATE INDEX "PosTable_organizationId_status_idx" ON "PosTable" ("organizationId", status);
CREATE INDEX "PosTable_organizationId_zone_idx"   ON "PosTable" ("organizationId", zone);
CREATE INDEX "PosTable_organizationId_active_idx" ON "PosTable" ("organizationId", active);

-- ---------------------------------------------------------------------------
-- 4. PosTableOrder
-- ---------------------------------------------------------------------------
CREATE TABLE "PosTableOrder" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "tableId"       UUID NOT NULL,
  "documentId"    TEXT NOT NULL,
  "customerName"  TEXT,
  "guestCount"    INTEGER,
  "openedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"      TIMESTAMP(3),
  notes           TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "createdBy"     TEXT,
  "updatedBy"     TEXT,

  CONSTRAINT "PosTableOrder_pkey" PRIMARY KEY (id),
  CONSTRAINT "PosTableOrder_tableId_fkey" FOREIGN KEY ("tableId")
    REFERENCES "PosTable"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PosTableOrder_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "Document"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PosTableOrder_tableId_documentId_key"
  ON "PosTableOrder" ("tableId", "documentId");
CREATE INDEX "PosTableOrder_organizationId_idx"
  ON "PosTableOrder" ("organizationId");
CREATE INDEX "PosTableOrder_organizationId_tableId_closedAt_idx"
  ON "PosTableOrder" ("organizationId", "tableId", "closedAt");
CREATE INDEX "PosTableOrder_organizationId_documentId_idx"
  ON "PosTableOrder" ("organizationId", "documentId");
CREATE INDEX "PosTableOrder_organizationId_openedAt_idx"
  ON "PosTableOrder" ("organizationId", "openedAt");

-- ---------------------------------------------------------------------------
-- 5. PosTableReservation
-- ---------------------------------------------------------------------------
CREATE TABLE "PosTableReservation" (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"  TEXT NOT NULL,
  "tableId"         UUID NOT NULL,
  "customerName"    TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  "partySize"       INTEGER NOT NULL DEFAULT 2,
  "startAt"         TIMESTAMP(3) NOT NULL,
  "endAt"           TIMESTAMP(3) NOT NULL,
  status            "PosReservationStatus" NOT NULL DEFAULT 'pending',
  notes             TEXT,
  "seatedAt"        TIMESTAMP(3),
  "noShowAt"        TIMESTAMP(3),
  "cancelledAt"     TIMESTAMP(3),
  "seatedDocumentId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "createdBy"       TEXT,
  "updatedBy"       TEXT,

  CONSTRAINT "PosTableReservation_pkey" PRIMARY KEY (id),
  CONSTRAINT "PosTableReservation_tableId_fkey" FOREIGN KEY ("tableId")
    REFERENCES "PosTable"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PosTableReservation_organizationId_idx"
  ON "PosTableReservation" ("organizationId");
CREATE INDEX "PosTableReservation_organizationId_tableId_idx"
  ON "PosTableReservation" ("organizationId", "tableId");
CREATE INDEX "PosTableReservation_organizationId_status_startAt_idx"
  ON "PosTableReservation" ("organizationId", status, "startAt");
CREATE INDEX "PosTableReservation_organizationId_startAt_idx"
  ON "PosTableReservation" ("organizationId", "startAt");

-- ---------------------------------------------------------------------------
-- 6. RLS policy (mirrors the D2-1 pattern in migrations/20260621120000_d2_rls)
-- ---------------------------------------------------------------------------
ALTER TABLE "PosTable"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTableOrder"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosTableReservation" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "PosTable"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "PosTableOrder"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "PosTableReservation" FORCE ROW LEVEL SECURITY;

-- tenant_isolation: only rows whose organizationId matches the GUC
-- app.org_id (set by PrismaService inside every transaction).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table') THEN
    CREATE POLICY tenant_isolation_pos_table ON "PosTable"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table_order') THEN
    CREATE POLICY tenant_isolation_pos_table_order ON "PosTableOrder"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='tenant_isolation_pos_table_reservation') THEN
    CREATE POLICY tenant_isolation_pos_table_reservation ON "PosTableReservation"
      USING ("organizationId" = current_setting('app.org_id', true))
      WITH CHECK ("organizationId" = current_setting('app.org_id', true));
  END IF;
END $$;