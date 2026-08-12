-- MENU-1: attach modifier groups to sellable MenuItems (re-home from products).
CREATE TABLE "MenuItemModifierGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MenuItemModifierGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MenuItemModifierGroup_menuItemId_modifierGroupId_key" ON "MenuItemModifierGroup"("menuItemId", "modifierGroupId");
CREATE INDEX "MenuItemModifierGroup_organizationId_idx" ON "MenuItemModifierGroup"("organizationId");
CREATE INDEX "MenuItemModifierGroup_menuItemId_idx" ON "MenuItemModifierGroup"("menuItemId");

ALTER TABLE "MenuItemModifierGroup"
    ADD CONSTRAINT "MenuItemModifierGroup_menuItemId_fkey"
    FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItemModifierGroup"
    ADD CONSTRAINT "MenuItemModifierGroup_modifierGroupId_fkey"
    FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over existing product→group assignments to the matching menu item
-- (menu items mirror products 1:1 by code in the current seed).
INSERT INTO "MenuItemModifierGroup" ("id", "organizationId", "menuItemId", "modifierGroupId", "sortOrder")
SELECT gen_random_uuid(), pmg."organizationId", mi."id", pmg."modifierGroupId", pmg."sortOrder"
FROM "ProductModifierGroup" pmg
JOIN "Product" p ON p."id" = pmg."productId"
JOIN "MenuItem" mi ON mi."organizationId" = pmg."organizationId" AND mi."code" = p."code"
ON CONFLICT ("menuItemId", "modifierGroupId") DO NOTHING;
