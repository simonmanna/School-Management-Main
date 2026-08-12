-- POS Phase E (P7) Loyalty + Store Credit + Customer Tabs
--   and POS Phase F Digital Menu (Phase 1 MVP).
--
-- Tables:
--   LoyaltyProgram   — org config (points per UGX, UGX per point).
--   LoyaltyLedger    — append-only point transactions per partner.
--   StoreCredit      — partner balance (gift cards, refunds-to-credit).
--   StoreCreditLedger — append-only credit transactions.
--   CustomerTab      — running "house tab" for a regular.
--   CustomerTabLedger — append-only tab charges + payments.
--   MenuQrSession    — QR code session: branch + table + token + expiry.
--   OnlineOrder      — customer order placed from the digital menu.

-- 1. Loyalty
CREATE TABLE "LoyaltyProgram" (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId"    TEXT NOT NULL,
  name                TEXT NOT NULL,
  "pointsPerCurrency" NUMERIC(20, 6) NOT NULL DEFAULT 1,
  "currencyPerPoint"  NUMERIC(20, 6) NOT NULL DEFAULT 100,
  "minPointsToRedeem" INTEGER NOT NULL DEFAULT 50,
  "pointsExpireDays"  INTEGER NOT NULL DEFAULT 365,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY (id)
);
CREATE UNIQUE INDEX "LoyaltyProgram_organizationId_name_key" ON "LoyaltyProgram" ("organizationId", name);
CREATE INDEX "LoyaltyProgram_organizationId_idx" ON "LoyaltyProgram" ("organizationId");

CREATE TABLE "LoyaltyLedger" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "partnerId"     TEXT NOT NULL,
  delta           NUMERIC(20, 6) NOT NULL,
  "balanceAfter"  NUMERIC(20, 6) NOT NULL,
  reason          TEXT NOT NULL,
  "documentId"    TEXT,
  "expiresAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,
  CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY (id)
);
CREATE INDEX "LoyaltyLedger_organizationId_partnerId_createdAt_idx"
  ON "LoyaltyLedger" ("organizationId", "partnerId", "createdAt");
CREATE INDEX "LoyaltyLedger_organizationId_partnerId_reason_idx"
  ON "LoyaltyLedger" ("organizationId", "partnerId", reason);
CREATE INDEX "LoyaltyLedger_expiresAt_idx" ON "LoyaltyLedger" ("expiresAt");

-- 2. Store Credit
CREATE TABLE "StoreCredit" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "partnerId"     TEXT NOT NULL,
  balance         NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "expiresAt"     TIMESTAMP(3),
  source          TEXT,
  notes           TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreCredit_pkey" PRIMARY KEY (id),
  CONSTRAINT "StoreCredit_organizationId_partnerId_key" UNIQUE ("organizationId", "partnerId")
);
CREATE INDEX "StoreCredit_organizationId_idx" ON "StoreCredit" ("organizationId");
CREATE INDEX "StoreCredit_organizationId_partnerId_idx" ON "StoreCredit" ("organizationId", "partnerId");

CREATE TABLE "StoreCreditLedger" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "storeCreditId" UUID NOT NULL,
  delta           NUMERIC(20, 6) NOT NULL,
  "balanceAfter"  NUMERIC(20, 6) NOT NULL,
  reason          TEXT NOT NULL,
  "documentId"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,
  CONSTRAINT "StoreCreditLedger_pkey" PRIMARY KEY (id),
  CONSTRAINT "StoreCreditLedger_storeCreditId_fkey" FOREIGN KEY ("storeCreditId")
    REFERENCES "StoreCredit"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StoreCreditLedger_organizationId_storeCreditId_createdAt_idx"
  ON "StoreCreditLedger" ("organizationId", "storeCreditId", "createdAt");

-- 3. Customer Tabs
CREATE TABLE "CustomerTab" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "partnerId"     TEXT NOT NULL,
  balance         NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "creditLimit"   NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "cashSessionId" TEXT,
  "isOpen"        BOOLEAN NOT NULL DEFAULT true,
  "openedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"      TIMESTAMP(3),
  notes           TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerTab_pkey" PRIMARY KEY (id),
  CONSTRAINT "CustomerTab_organizationId_partnerId_key" UNIQUE ("organizationId", "partnerId")
);
CREATE INDEX "CustomerTab_organizationId_idx" ON "CustomerTab" ("organizationId");

CREATE TABLE "CustomerTabLedger" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "tabId"         UUID NOT NULL,
  delta           NUMERIC(20, 6) NOT NULL,
  "balanceAfter"  NUMERIC(20, 6) NOT NULL,
  reason          TEXT NOT NULL,
  "documentId"    TEXT,
  "paymentId"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,
  CONSTRAINT "CustomerTabLedger_pkey" PRIMARY KEY (id),
  CONSTRAINT "CustomerTabLedger_tabId_fkey" FOREIGN KEY ("tabId")
    REFERENCES "CustomerTab"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomerTabLedger_organizationId_tabId_createdAt_idx"
  ON "CustomerTabLedger" ("organizationId", "tabId", "createdAt");

-- 4. Digital Menu (Phase 1 MVP)
CREATE TYPE "OnlineOrderStatus" AS ENUM ('received', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled');

CREATE TABLE "MenuQrSession" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "branchId"      TEXT NOT NULL,
  "tableNumber"   TEXT,
  token           TEXT NOT NULL,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"    TIMESTAMP(3),
  CONSTRAINT "MenuQrSession_pkey" PRIMARY KEY (id),
  CONSTRAINT "MenuQrSession_token_key" UNIQUE (token)
);
CREATE INDEX "MenuQrSession_organizationId_branchId_idx"
  ON "MenuQrSession" ("organizationId", "branchId");
CREATE INDEX "MenuQrSession_organizationId_isActive_idx"
  ON "MenuQrSession" ("organizationId", "isActive");

CREATE TABLE "OnlineOrder" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "sessionId"     UUID,
  "customerName"  TEXT NOT NULL,
  "customerPhone" TEXT,
  "customerEmail" TEXT,
  "orderType"     TEXT NOT NULL DEFAULT 'dine_in',
  items           JSONB NOT NULL,
  subtotal        NUMERIC(20, 6) NOT NULL,
  "taxAmount"     NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "totalAmount"   NUMERIC(20, 6) NOT NULL,
  "invoiceId"     UUID,
  "paymentMethod" TEXT,
  "paymentRef"    TEXT,
  status          "OnlineOrderStatus" NOT NULL DEFAULT 'received',
  notes           TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY (id),
  CONSTRAINT "OnlineOrder_sessionId_fkey" FOREIGN KEY ("sessionId")
    REFERENCES "MenuQrSession"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "OnlineOrder_organizationId_status_createdAt_idx"
  ON "OnlineOrder" ("organizationId", status, "createdAt");
CREATE INDEX "OnlineOrder_organizationId_sessionId_idx"
  ON "OnlineOrder" ("organizationId", "sessionId");
CREATE INDEX "OnlineOrder_organizationId_customerPhone_idx"
  ON "OnlineOrder" ("organizationId", "customerPhone");