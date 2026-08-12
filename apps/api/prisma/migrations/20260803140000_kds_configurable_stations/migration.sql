-- ---------------------------------------------------------------------------
-- KDS enterprise upgrade — configurable kitchen stations + ticket enrichment.
--
--  * Retire the fixed `PosStation` enum (bar/kitchen/cafe): Product.station and
--    KitchenTicket.station become free-text station CODES backed by a new
--    per-org `KitchenStation` config table. Existing values ('bar'/'kitchen'/
--    'cafe') are valid strings, so the cast is data-preserving; the three
--    defaults are seeded per org by the app (KitchenStationService.ensureDefaults
--    / the seed script).
--  * KitchenTicket gains queue numbers, priority, order-type tag, chef identity
--    and recall tracking.
--  * MenuItem gains an optional station override; OrderItem gains a course.
-- ---------------------------------------------------------------------------

-- 1. Priority enum for KDS tickets.
CREATE TYPE "KdsPriority" AS ENUM ('normal', 'rush', 'vip');

-- 2. Configurable kitchen stations.
CREATE TABLE "KitchenStation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "printerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KitchenStation_organizationId_code_key" ON "KitchenStation"("organizationId", "code");
CREATE INDEX "KitchenStation_organizationId_isActive_idx" ON "KitchenStation"("organizationId", "isActive");

-- 3. Product.station: PosStation enum -> TEXT (station code).
ALTER TABLE "Product" ALTER COLUMN "station" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "station" TYPE TEXT USING "station"::text;
ALTER TABLE "Product" ALTER COLUMN "station" SET DEFAULT 'cafe';

-- 4. KitchenTicket.station: PosStation enum -> TEXT, plus new columns.
ALTER TABLE "KitchenTicket" ALTER COLUMN "station" TYPE TEXT USING "station"::text;
ALTER TABLE "KitchenTicket"
    ADD COLUMN "ticketNo" TEXT,
    ADD COLUMN "priority" "KdsPriority" NOT NULL DEFAULT 'normal',
    ADD COLUMN "orderType" TEXT,
    ADD COLUMN "startedBy" TEXT,
    ADD COLUMN "readyBy" TEXT,
    ADD COLUMN "assignedTo" TEXT,
    ADD COLUMN "recallCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "recallReason" TEXT;
CREATE INDEX "KitchenTicket_organizationId_priority_status_idx" ON "KitchenTicket"("organizationId", "priority", "status");

-- 5. Drop the now-unused enum type.
DROP TYPE "PosStation";

-- 6. MenuItem station override + OrderItem course.
ALTER TABLE "MenuItem" ADD COLUMN "stationCode" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "course" INTEGER;

-- 7. Tenant-isolation policy for the new table. We create the policy + FORCE
--    (matching every other org-scoped table's persistent shape) but do NOT
--    `ENABLE ROW LEVEL SECURITY` here: in this deployment RLS is left inert and
--    tenant isolation is enforced by the app-side Prisma tenancy extension
--    (app.org_id is only set inside interactive transactions, so a table with
--    RLS *enabled* would reject the app's ordinary standalone queries). The
--    policy lies dormant until an operator turns RLS on org-wide via
--    `pnpm rls:setup-role`, exactly like Product/Order/etc.
ALTER TABLE "KitchenStation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "KitchenStation";
CREATE POLICY tenant_isolation ON "KitchenStation"
    USING ("organizationId" = current_setting('app.org_id', true));
