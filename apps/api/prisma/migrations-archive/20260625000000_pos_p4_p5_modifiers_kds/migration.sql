-- POS Phase D — Modifiers + Combos (P4) and KDS station routing (P5).
--
-- Adds:
--   - PosStation enum + Product.station column (defaults to 'cafe')
--   - ModifierGroup + Modifier + ProductModifierGroup
--   - Combo + ComboItem
--   - KdsTicketStatus enum + KitchenTicket table
--
-- All tables are org-scoped (added to the tenancy extension whitelist
-- by the next prisma generate pass).

-- 1. PosStation enum + Product.station
CREATE TYPE "PosStation" AS ENUM ('bar', 'kitchen', 'cafe');

ALTER TABLE "Product"
  ADD COLUMN "station" "PosStation" NOT NULL DEFAULT 'cafe';

-- 2. ModifierGroup + Modifier + ProductModifierGroup
CREATE TABLE "ModifierGroup" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  name           TEXT NOT NULL,
  "minSelect"    INTEGER NOT NULL DEFAULT 0,
  "maxSelect"    INTEGER NOT NULL DEFAULT 1,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "ModifierGroup_organizationId_name_key" ON "ModifierGroup" ("organizationId", name);
CREATE INDEX "ModifierGroup_organizationId_idx" ON "ModifierGroup" ("organizationId");

CREATE TABLE "Modifier" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  "groupId"      TEXT NOT NULL,
  name           TEXT NOT NULL,
  "priceDelta"   NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "isDefault"    BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Modifier_pkey" PRIMARY KEY (id),
  CONSTRAINT "Modifier_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "ModifierGroup"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Modifier_organizationId_idx" ON "Modifier" ("organizationId");
CREATE INDEX "Modifier_groupId_idx" ON "Modifier" ("groupId");

CREATE TABLE "ProductModifierGroup" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "modifierGroupId" TEXT NOT NULL,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY (id),
  CONSTRAINT "ProductModifierGroup_productId_modifierGroupId_key" UNIQUE ("productId", "modifierGroupId"),
  CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId")
    REFERENCES "ModifierGroup"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductModifierGroup_organizationId_idx" ON "ProductModifierGroup" ("organizationId");

-- 3. Combo + ComboItem
CREATE TABLE "Combo" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  name           TEXT NOT NULL,
  price          NUMERIC(20, 6) NOT NULL,
  description    TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "imageUrl"     TEXT,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Combo_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "Combo_organizationId_name_key" ON "Combo" ("organizationId", name);
CREATE INDEX "Combo_organizationId_idx" ON "Combo" ("organizationId");

CREATE TABLE "ComboItem" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  "comboId"      TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "ComboItem_pkey" PRIMARY KEY (id),
  CONSTRAINT "ComboItem_comboId_productId_key" UNIQUE ("comboId", "productId"),
  CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId")
    REFERENCES "Combo"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ComboItem_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ComboItem_organizationId_idx" ON "ComboItem" ("organizationId");
CREATE INDEX "ComboItem_comboId_idx" ON "ComboItem" ("comboId");

-- 4. KdsTicketStatus enum + KitchenTicket
CREATE TYPE "KdsTicketStatus" AS ENUM ('new', 'preparing', 'ready', 'served', 'cancelled');

CREATE TABLE "KitchenTicket" (
  id             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "organizationId" TEXT NOT NULL,
  "invoiceId"    TEXT NOT NULL,
  label          TEXT NOT NULL,
  station        "PosStation" NOT NULL,
  status         "KdsTicketStatus" NOT NULL DEFAULT 'new',
  items          JSONB NOT NULL,
  "startedAt"    TIMESTAMP(3),
  "readyAt"      TIMESTAMP(3),
  "servedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY (id)
);
CREATE INDEX "KitchenTicket_organizationId_station_status_idx"
  ON "KitchenTicket" ("organizationId", station, status);
CREATE INDEX "KitchenTicket_organizationId_createdAt_idx"
  ON "KitchenTicket" ("organizationId", "createdAt");
CREATE INDEX "KitchenTicket_invoiceId_idx"
  ON "KitchenTicket" ("invoiceId");