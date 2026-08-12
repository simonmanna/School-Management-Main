-- POS Phase A additions: held orders + manager PIN column.
--
-- PosHold = a lightweight "parking spot" for a partially-built cart. The
-- cashier builds lines, taps "Hold", the cart is parked under a friendly
-- name ("Sarah / table 3"), and is recalled later via /pos/holds/:id/recall
-- which materialises it into a real sales_invoice + payment through the
-- existing DocumentBuilderService. No new money primitives are introduced.
--
-- User.pinHash = optional bcrypt-hashed manager PIN (separate from
-- passwordHash) used by /pos/override/verify. Null = manager hasn't set a
-- PIN yet; the cashier flow prompts them to enroll one on first use.

-- ---------------------------------------------------------------------------
-- 1. Manager PIN on User
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN "pinHash"      TEXT;
ALTER TABLE "User" ADD COLUMN "pinHashRounds" INTEGER;

-- ---------------------------------------------------------------------------
-- 2. PosHold + PosHoldLine
-- ---------------------------------------------------------------------------

CREATE TYPE "PosHoldStatus" AS ENUM ('open', 'recalled', 'cancelled');

CREATE TABLE "PosHold" (
  id             UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  name           TEXT NOT NULL,
  "partnerId"    TEXT,
  "branchId"     TEXT,
  "cashSessionId" TEXT,
  "totalAmount"  NUMERIC(20, 6) NOT NULL DEFAULT 0,
  status         "PosHoldStatus" NOT NULL DEFAULT 'open',
  notes          TEXT,
  "heldById"     TEXT,
  "recalledById" TEXT,
  "recalledAt"   TIMESTAMP(3),
  "cancelledById" TEXT,
  "cancelledAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PosHold_pkey" PRIMARY KEY (id)
);

CREATE INDEX "PosHold_organizationId_idx"                  ON "PosHold" ("organizationId");
CREATE INDEX "PosHold_organizationId_status_idx"           ON "PosHold" ("organizationId", status);
CREATE INDEX "PosHold_organizationId_cashSessionId_status_idx" ON "PosHold" ("organizationId", "cashSessionId", status);
CREATE INDEX "PosHold_organizationId_branchId_status_idx"  ON "PosHold" ("organizationId", "branchId", status);

CREATE TABLE "PosHoldLine" (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" TEXT NOT NULL,
  "holdId"        UUID NOT NULL,
  "productId"     TEXT,
  description     TEXT NOT NULL,
  quantity        NUMERIC(20, 6) NOT NULL DEFAULT 1,
  "unitPrice"     NUMERIC(20, 6) NOT NULL DEFAULT 0,
  "discountPercent" NUMERIC(9, 4) NOT NULL DEFAULT 0,
  "taxId"         TEXT,
  "lineNumber"    INTEGER NOT NULL DEFAULT 0,
  note            TEXT,

  CONSTRAINT "PosHoldLine_pkey" PRIMARY KEY (id),
  CONSTRAINT "PosHoldLine_holdId_fkey" FOREIGN KEY ("holdId")
    REFERENCES "PosHold"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PosHoldLine_organizationId_idx" ON "PosHoldLine" ("organizationId");
CREATE INDEX "PosHoldLine_holdId_idx"         ON "PosHoldLine" ("holdId");