-- H4: optional tax category on a menu item (menu items have no single stock
-- product to inherit tax from; resolved server-side at order time).
ALTER TABLE "MenuItem" ADD COLUMN "taxId" TEXT;

-- H3: link a modifier to a stock product so selecting it depletes inventory
-- (mirrors AccompanimentOption.inventoryItemId). Best-effort at sale time.
ALTER TABLE "Modifier" ADD COLUMN "inventoryItemId" TEXT;

-- H3: persist the selected AccompanimentOption ids on the order/invoice line so
-- settlement can deplete each option's inventoryItemId (names stay for display).
ALTER TABLE "OrderItem" ADD COLUMN "accompanimentOptionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InvoiceItem" ADD COLUMN "accompanimentOptionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
