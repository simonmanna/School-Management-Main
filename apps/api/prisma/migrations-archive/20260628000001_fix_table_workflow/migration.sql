-- Remove 'dirty' from PosTableStatus enum
CREATE TYPE "PosTableStatus_new" AS ENUM ('available','occupied','reserved','out_of_service');

-- Drop default, change type, restore default, drop old type
ALTER TABLE "PosTable" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PosTable" ALTER COLUMN "status" TYPE "PosTableStatus_new" USING 
  CASE WHEN "status" = 'dirty' THEN 'available'::text ELSE "status"::text END::"PosTableStatus_new";
ALTER TABLE "PosTable" ALTER COLUMN "status" SET DEFAULT 'available'::"PosTableStatus_new";

DROP TYPE "PosTableStatus";
ALTER TYPE "PosTableStatus_new" RENAME TO "PosTableStatus";

-- One open order per table (partial unique index)
CREATE UNIQUE INDEX "PosTableOrder_one_open_per_table" 
ON "PosTableOrder" ("tableId") WHERE "closedAt" IS NULL;