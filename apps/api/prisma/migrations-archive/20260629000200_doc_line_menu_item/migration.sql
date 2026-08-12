-- MENU-2: tag each sale line with the MenuItem it represents (for recipe-based
-- stock deduction at settle and menu-level reporting).
ALTER TABLE "DocumentLine" ADD COLUMN "menuItemId" TEXT;
CREATE INDEX "DocumentLine_menuItemId_idx" ON "DocumentLine"("menuItemId");
