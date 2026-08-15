-- Meals V1–V3: programs, meal types, entitlements, assignments, sessions,
-- attendance, menus, recipes, production, consumption, waste + wallet ledger.
-- Reuses Document/Payment/Posting (money) and Inventory (stock); no new
-- accounting primitives.

-- CreateEnum
CREATE TYPE "MealAssignmentStatus" AS ENUM ('active', 'suspended', 'ended', 'cancelled');
CREATE TYPE "MealAttendanceStatus" AS ENUM ('served', 'absent', 'excused', 'not_eligible');
CREATE TYPE "MealAccountTxnType" AS ENUM ('top_up', 'purchase', 'refund', 'adjustment', 'reversal');
CREATE TYPE "MealProductionStatus" AS ENUM ('preparing', 'ready', 'served', 'cancelled');
CREATE TYPE "MealWasteReason" AS ENUM ('overproduction', 'spoilage', 'burnt', 'damaged', 'returned', 'other');

-- AlterTable: evolve the existing wallet MealPlan into the entitlement/plan layer.
ALTER TABLE "MealPlan"
  ADD COLUMN "mealProgramId" TEXT,
  ADD COLUMN "billingModel"  TEXT NOT NULL DEFAULT 'term_plan',
  ADD COLUMN "fundingModel"  TEXT NOT NULL DEFAULT 'parent_funded',
  ADD COLUMN "createdBy"     TEXT,
  ADD COLUMN "updatedBy"     TEXT;

-- CreateTable
CREATE TABLE "MealProgram" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "kind"           TEXT NOT NULL DEFAULT 'custom',
  "description"    TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "MealProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealType" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "startTime"      TEXT,
  "endTime"        TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "MealType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealPlanEntitlement" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mealPlanId"     TEXT NOT NULL,
  "mealTypeId"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealPlanEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealPlanAssignment" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "mealPlanId"       TEXT NOT NULL,
  "termId"           TEXT NOT NULL,
  "startDate"        TIMESTAMP(3) NOT NULL,
  "endDate"          TIMESTAMP(3),
  "status"           "MealAssignmentStatus" NOT NULL DEFAULT 'active',
  "reason"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "createdBy"        TEXT,
  "updatedBy"        TEXT,
  CONSTRAINT "MealPlanAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealSession" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mealTypeId"     TEXT NOT NULL,
  "date"           TIMESTAMP(3) NOT NULL,
  "classId"        TEXT,
  "sectionId"      TEXT,
  "mealPlanId"     TEXT,
  "expectedCount"  INTEGER NOT NULL DEFAULT 0,
  "servedCount"    INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "MealSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealAttendance" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "mealSessionId"    TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "status"           "MealAttendanceStatus" NOT NULL DEFAULT 'served',
  "reason"           TEXT,
  "markedById"       TEXT,
  "markedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealAttendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealMenu" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mealTypeId"     TEXT NOT NULL,
  "date"           TIMESTAMP(3),
  "dayOfWeek"      INTEGER,
  "mealPlanId"     TEXT,
  "title"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "MealMenu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealMenuItem" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mealMenuId"     TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "notes"          TEXT,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "mealRecipeId"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealMenuItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealRecipe" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "portionYield"   INTEGER NOT NULL DEFAULT 1,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "MealRecipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealRecipeIngredient" (
  "id"                 TEXT NOT NULL,
  "organizationId"     TEXT NOT NULL,
  "mealRecipeId"       TEXT NOT NULL,
  "productId"          TEXT NOT NULL,
  "quantityPerPortion" DECIMAL(20,6) NOT NULL,
  "uomId"              TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealRecipeIngredient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealProductionPlan" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "mealTypeId"       TEXT NOT NULL,
  "date"             TIMESTAMP(3) NOT NULL,
  "mealSessionId"    TEXT,
  "expectedPortions" INTEGER NOT NULL DEFAULT 0,
  "status"           "MealProductionStatus" NOT NULL DEFAULT 'preparing',
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "createdBy"        TEXT,
  "updatedBy"        TEXT,
  "deletedAt"        TIMESTAMP(3),
  CONSTRAINT "MealProductionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealProductionItem" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "mealProductionPlanId" TEXT NOT NULL,
  "productId"            TEXT NOT NULL,
  "uomId"                TEXT,
  "plannedQuantity"      DECIMAL(20,6) NOT NULL DEFAULT 0,
  "issuedQuantity"       DECIMAL(20,6) NOT NULL DEFAULT 0,
  "consumedQuantity"     DECIMAL(20,6) NOT NULL DEFAULT 0,
  "wastedQuantity"       DECIMAL(20,6) NOT NULL DEFAULT 0,
  "returnedQuantity"     DECIMAL(20,6) NOT NULL DEFAULT 0,
  "unitCost"             DECIMAL(20,6) NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MealProductionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealConsumption" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "mealProductionPlanId" TEXT NOT NULL,
  "productId"            TEXT NOT NULL,
  "quantity"             DECIMAL(20,6) NOT NULL,
  "unitCost"             DECIMAL(20,6) NOT NULL DEFAULT 0,
  "inventoryLedgerId"    TEXT,
  "stockLocationId"      TEXT,
  "consumedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById"         TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealConsumption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealWaste" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "mealProductionPlanId" TEXT,
  "mealSessionId"        TEXT,
  "productId"            TEXT,
  "quantity"             DECIMAL(20,6) NOT NULL,
  "uomId"                TEXT,
  "cost"                 DECIMAL(20,6) NOT NULL DEFAULT 0,
  "reason"               "MealWasteReason" NOT NULL DEFAULT 'other',
  "notes"                TEXT,
  "recordedById"         TEXT,
  "recordedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealWaste_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MealAccountTransaction" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "mealAccountId"  TEXT NOT NULL,
  "type"           "MealAccountTxnType" NOT NULL,
  "amount"         DECIMAL(20,6) NOT NULL,
  "balanceAfter"   DECIMAL(20,6) NOT NULL,
  "reference"      TEXT,
  "paymentId"      TEXT,
  "sourceType"     TEXT,
  "sourceId"       TEXT,
  "notes"          TEXT,
  "recordedById"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MealAccountTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (MealPlan additions)
CREATE INDEX "MealPlan_mealProgramId_idx" ON "MealPlan"("mealProgramId");

-- CreateIndex (unique natural keys)
CREATE UNIQUE INDEX "MealProgram_organizationId_name_key" ON "MealProgram"("organizationId", "name");
CREATE INDEX "MealProgram_organizationId_idx" ON "MealProgram"("organizationId");

CREATE UNIQUE INDEX "MealType_organizationId_name_key" ON "MealType"("organizationId", "name");
CREATE INDEX "MealType_organizationId_idx" ON "MealType"("organizationId");

CREATE UNIQUE INDEX "MealPlanEntitlement_organizationId_mealPlanId_mealTypeId_key" ON "MealPlanEntitlement"("organizationId", "mealPlanId", "mealTypeId");
CREATE INDEX "MealPlanEntitlement_organizationId_idx" ON "MealPlanEntitlement"("organizationId");
CREATE INDEX "MealPlanEntitlement_mealPlanId_idx" ON "MealPlanEntitlement"("mealPlanId");

CREATE INDEX "MealPlanAssignment_organizationId_idx" ON "MealPlanAssignment"("organizationId");
CREATE INDEX "MealPlanAssignment_studentProfileId_idx" ON "MealPlanAssignment"("studentProfileId");
CREATE INDEX "MealPlanAssignment_organizationId_termId_idx" ON "MealPlanAssignment"("organizationId", "termId");
CREATE INDEX "MealPlanAssignment_mealPlanId_idx" ON "MealPlanAssignment"("mealPlanId");
-- Invariant: at most ONE active plan per student per term. Historical
-- (suspended/ended/cancelled) rows are unconstrained so history is preserved.
CREATE UNIQUE INDEX "MealPlanAssignment_active_unique"
  ON "MealPlanAssignment" ("organizationId", "studentProfileId", "termId")
  WHERE "status" = 'active';

CREATE INDEX "MealSession_organizationId_idx" ON "MealSession"("organizationId");
CREATE INDEX "MealSession_organizationId_date_idx" ON "MealSession"("organizationId", "date");
CREATE INDEX "MealSession_mealTypeId_date_idx" ON "MealSession"("mealTypeId", "date");
-- One session per (date, meal type) at each scope. Two partials because classId
-- is nullable (NULLS DISTINCT would otherwise permit duplicates).
CREATE UNIQUE INDEX "MealSession_schoolwide_unique"
  ON "MealSession" ("organizationId", "date", "mealTypeId")
  WHERE "classId" IS NULL;
CREATE UNIQUE INDEX "MealSession_class_unique"
  ON "MealSession" ("organizationId", "date", "mealTypeId", "classId")
  WHERE "classId" IS NOT NULL;

CREATE UNIQUE INDEX "MealAttendance_organizationId_mealSessionId_studentProfileId_key" ON "MealAttendance"("organizationId", "mealSessionId", "studentProfileId");
CREATE INDEX "MealAttendance_organizationId_idx" ON "MealAttendance"("organizationId");
CREATE INDEX "MealAttendance_mealSessionId_idx" ON "MealAttendance"("mealSessionId");
CREATE INDEX "MealAttendance_studentProfileId_idx" ON "MealAttendance"("studentProfileId");

CREATE INDEX "MealMenu_organizationId_idx" ON "MealMenu"("organizationId");
CREATE INDEX "MealMenu_mealTypeId_idx" ON "MealMenu"("mealTypeId");

CREATE INDEX "MealMenuItem_organizationId_idx" ON "MealMenuItem"("organizationId");
CREATE INDEX "MealMenuItem_mealMenuId_idx" ON "MealMenuItem"("mealMenuId");

CREATE UNIQUE INDEX "MealRecipe_organizationId_name_key" ON "MealRecipe"("organizationId", "name");
CREATE INDEX "MealRecipe_organizationId_idx" ON "MealRecipe"("organizationId");

CREATE INDEX "MealRecipeIngredient_organizationId_idx" ON "MealRecipeIngredient"("organizationId");
CREATE INDEX "MealRecipeIngredient_mealRecipeId_idx" ON "MealRecipeIngredient"("mealRecipeId");

CREATE INDEX "MealProductionPlan_organizationId_idx" ON "MealProductionPlan"("organizationId");
CREATE INDEX "MealProductionPlan_organizationId_date_idx" ON "MealProductionPlan"("organizationId", "date");
CREATE INDEX "MealProductionPlan_mealTypeId_date_idx" ON "MealProductionPlan"("mealTypeId", "date");

CREATE INDEX "MealProductionItem_organizationId_idx" ON "MealProductionItem"("organizationId");
CREATE INDEX "MealProductionItem_mealProductionPlanId_idx" ON "MealProductionItem"("mealProductionPlanId");

CREATE INDEX "MealConsumption_organizationId_idx" ON "MealConsumption"("organizationId");
CREATE INDEX "MealConsumption_mealProductionPlanId_idx" ON "MealConsumption"("mealProductionPlanId");

CREATE INDEX "MealWaste_organizationId_idx" ON "MealWaste"("organizationId");
CREATE INDEX "MealWaste_mealProductionPlanId_idx" ON "MealWaste"("mealProductionPlanId");

CREATE INDEX "MealAccountTransaction_organizationId_idx" ON "MealAccountTransaction"("organizationId");
CREATE INDEX "MealAccountTransaction_mealAccountId_idx" ON "MealAccountTransaction"("mealAccountId");

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_mealProgramId_fkey" FOREIGN KEY ("mealProgramId") REFERENCES "MealProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MealPlanEntitlement" ADD CONSTRAINT "MealPlanEntitlement_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealPlanEntitlement" ADD CONSTRAINT "MealPlanEntitlement_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MealPlanAssignment" ADD CONSTRAINT "MealPlanAssignment_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealPlanAssignment" ADD CONSTRAINT "MealPlanAssignment_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MealPlanAssignment" ADD CONSTRAINT "MealPlanAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MealSession" ADD CONSTRAINT "MealSession_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MealAttendance" ADD CONSTRAINT "MealAttendance_mealSessionId_fkey" FOREIGN KEY ("mealSessionId") REFERENCES "MealSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealAttendance" ADD CONSTRAINT "MealAttendance_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MealMenu" ADD CONSTRAINT "MealMenu_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MealMenuItem" ADD CONSTRAINT "MealMenuItem_mealMenuId_fkey" FOREIGN KEY ("mealMenuId") REFERENCES "MealMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MealMenuItem" ADD CONSTRAINT "MealMenuItem_mealRecipeId_fkey" FOREIGN KEY ("mealRecipeId") REFERENCES "MealRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MealRecipeIngredient" ADD CONSTRAINT "MealRecipeIngredient_mealRecipeId_fkey" FOREIGN KEY ("mealRecipeId") REFERENCES "MealRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MealProductionPlan" ADD CONSTRAINT "MealProductionPlan_mealTypeId_fkey" FOREIGN KEY ("mealTypeId") REFERENCES "MealType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MealProductionItem" ADD CONSTRAINT "MealProductionItem_mealProductionPlanId_fkey" FOREIGN KEY ("mealProductionPlanId") REFERENCES "MealProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MealConsumption" ADD CONSTRAINT "MealConsumption_mealProductionPlanId_fkey" FOREIGN KEY ("mealProductionPlanId") REFERENCES "MealProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MealWaste" ADD CONSTRAINT "MealWaste_mealProductionPlanId_fkey" FOREIGN KEY ("mealProductionPlanId") REFERENCES "MealProductionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MealAccountTransaction" ADD CONSTRAINT "MealAccountTransaction_mealAccountId_fkey" FOREIGN KEY ("mealAccountId") REFERENCES "MealAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
