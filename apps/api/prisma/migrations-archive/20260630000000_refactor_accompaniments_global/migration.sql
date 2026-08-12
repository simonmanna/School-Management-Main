-- Refactor AccompanimentGroup from per-menu-item to global (many-to-many via join table)
-- Matching the ModifierGroup pattern.

-- 1. Create join table
CREATE TABLE "MenuItemAccompanimentGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "accompanimentGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuItemAccompanimentGroup_pkey" PRIMARY KEY ("id")
);

-- 2. Drop FK and index on old menuItemId column
ALTER TABLE "AccompanimentGroup" DROP CONSTRAINT IF EXISTS "AccompanimentGroup_menuItemId_fkey";
DROP INDEX IF EXISTS "AccompanimentGroup_menuItemId_idx";
DROP INDEX IF EXISTS "AccompanimentGroup_organizationId_menuItemId_name_key";

-- 3. Drop menuItemId column
ALTER TABLE "AccompanimentGroup" DROP COLUMN "menuItemId";

-- 4. Add new unique constraint on organizationId + name
CREATE UNIQUE INDEX "AccompanimentGroup_organizationId_name_key" ON "AccompanimentGroup"("organizationId", "name");

-- 5. Add indexes on join table
CREATE UNIQUE INDEX "MenuItemAccompanimentGroup_menuItemId_accompanimentGroupId_key" ON "MenuItemAccompanimentGroup"("menuItemId", "accompanimentGroupId");
CREATE INDEX "MenuItemAccompanimentGroup_organizationId_idx" ON "MenuItemAccompanimentGroup"("organizationId");
CREATE INDEX "MenuItemAccompanimentGroup_menuItemId_idx" ON "MenuItemAccompanimentGroup"("menuItemId");

-- 6. Foreign keys on join table
ALTER TABLE "MenuItemAccompanimentGroup" ADD CONSTRAINT "MenuItemAccompanimentGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE;
ALTER TABLE "MenuItemAccompanimentGroup" ADD CONSTRAINT "MenuItemAccompanimentGroup_accompanimentGroupId_fkey" FOREIGN KEY ("accompanimentGroupId") REFERENCES "AccompanimentGroup"("id") ON DELETE CASCADE;
