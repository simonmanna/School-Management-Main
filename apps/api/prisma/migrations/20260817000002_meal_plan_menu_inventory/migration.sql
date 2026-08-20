-- Meal plans: inventory tracking + typed plan↔menu relation + per-student consumption
-- Adds the opt-in `trackInventory` flag, links MealPlan↔MealMenu, and widens
-- MealConsumption to record per-student (per-lunch) consumption of menu products.

-- 1. MealPlan.trackInventory flag
ALTER TABLE "MealPlan" ADD COLUMN "trackInventory" BOOLEAN NOT NULL DEFAULT false;

-- 2. MealPlan ↔ MealMenu typed relation (mealPlanId already exists as a scalar).
ALTER TABLE "MealMenu" DROP CONSTRAINT IF EXISTS "MealMenu_mealPlanId_fkey";
ALTER TABLE "MealMenu" ADD CONSTRAINT "MealMenu_mealPlanId_fkey"
  FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MealMenu_mealPlanId_idx" ON "MealMenu" ("mealPlanId");

-- 3. Widen MealConsumption for per-student / per-session / per-menu scope.
ALTER TABLE "MealConsumption" ALTER COLUMN "mealProductionPlanId" DROP NOT NULL;
ALTER TABLE "MealConsumption" ADD COLUMN "mealSessionId" TEXT;
ALTER TABLE "MealConsumption" ADD COLUMN "mealMenuId" TEXT;
ALTER TABLE "MealConsumption" ADD COLUMN "studentProfileId" TEXT;
CREATE INDEX IF NOT EXISTS "MealConsumption_mealSessionId_idx" ON "MealConsumption" ("mealSessionId");
CREATE INDEX IF NOT EXISTS "MealConsumption_studentProfileId_idx" ON "MealConsumption" ("studentProfileId");
CREATE INDEX IF NOT EXISTS "MealConsumption_mealMenuId_idx" ON "MealConsumption" ("mealMenuId");
