-- Add ModifierGroupType enum for ADD_ON vs MODIFIER distinction
CREATE TYPE "ModifierGroupType" AS ENUM ('ADD_ON', 'MODIFIER');

-- Add groupType column to ModifierGroup (default ADD_ON for backward compat)
ALTER TABLE "ModifierGroup" ADD COLUMN "groupType" "ModifierGroupType" NOT NULL DEFAULT 'ADD_ON';

-- CreateTable: MenuItemVariant (replaces basePrice when selected)
CREATE TABLE "MenuItemVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AccompanimentGroup (mutually-exclusive choices like "Choose 1 Side")
CREATE TABLE "AccompanimentGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "minSelect" INTEGER NOT NULL DEFAULT 1,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccompanimentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AccompanimentOption (individual options within a group, e.g. "Rice", "Fries")
CREATE TABLE "AccompanimentOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceImpact" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inventoryItemId" TEXT,

    CONSTRAINT "AccompanimentOption_pkey" PRIMARY KEY ("id")
);

-- Indexes for MenuItemVariant
CREATE INDEX "MenuItemVariant_organizationId_idx" ON "MenuItemVariant"("organizationId");
CREATE INDEX "MenuItemVariant_menuItemId_idx" ON "MenuItemVariant"("menuItemId");
CREATE UNIQUE INDEX "MenuItemVariant_organizationId_menuItemId_name_key" ON "MenuItemVariant"("organizationId", "menuItemId", "name");

-- Indexes for AccompanimentGroup
CREATE INDEX "AccompanimentGroup_organizationId_idx" ON "AccompanimentGroup"("organizationId");
CREATE INDEX "AccompanimentGroup_menuItemId_idx" ON "AccompanimentGroup"("menuItemId");
CREATE UNIQUE INDEX "AccompanimentGroup_organizationId_menuItemId_name_key" ON "AccompanimentGroup"("organizationId", "menuItemId", "name");

-- Indexes for AccompanimentOption
CREATE INDEX "AccompanimentOption_organizationId_idx" ON "AccompanimentOption"("organizationId");
CREATE INDEX "AccompanimentOption_groupId_idx" ON "AccompanimentOption"("groupId");
CREATE UNIQUE INDEX "AccompanimentOption_organizationId_groupId_name_key" ON "AccompanimentOption"("organizationId", "groupId", "name");

-- Foreign keys
ALTER TABLE "MenuItemVariant" ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccompanimentGroup" ADD CONSTRAINT "AccompanimentGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccompanimentOption" ADD CONSTRAINT "AccompanimentOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccompanimentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
