-- Enterprise UOM system (U1/U2/U4 schema).
-- Adds UOM categories (factor engine), promotes UnitOfMeasure with a conversion
-- factor + rounding, product UOM roles (sales/recipe/production) + sale rules,
-- packaging (qty of base + barcode), a per-product cross-category conversion
-- bridge, and a recipe-line unit on MenuProduct.

-- CreateTable
CREATE TABLE "UomCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceUomId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPackaging" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPackaging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUomConversion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromUomId" TEXT NOT NULL,
    "toUomId" TEXT NOT NULL,
    "factor" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUomConversion_pkey" PRIMARY KEY ("id")
);

-- AlterTable  (UnitOfMeasure — promote to the factor engine)
ALTER TABLE "UnitOfMeasure" ADD COLUMN     "symbol" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "roundingPrecision" DECIMAL(18,6) NOT NULL DEFAULT 0.000001,
ADD COLUMN     "uomType" TEXT NOT NULL DEFAULT 'reference';

-- AlterTable  (Product — UOM roles + sale rules)
ALTER TABLE "Product" ADD COLUMN     "salesUomId" TEXT,
ADD COLUMN     "recipeUomId" TEXT,
ADD COLUMN     "productionUomId" TEXT,
ADD COLUMN     "allowFractionalSale" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minSaleQty" DECIMAL(20,6),
ADD COLUMN     "maxSaleQty" DECIMAL(20,6);

-- AlterTable  (MenuProduct — recipe-line unit)
ALTER TABLE "MenuProduct" ADD COLUMN     "uomId" TEXT;

-- CreateIndex
CREATE INDEX "UomCategory_organizationId_idx" ON "UomCategory"("organizationId");
CREATE UNIQUE INDEX "UomCategory_organizationId_name_key" ON "UomCategory"("organizationId", "name");
CREATE INDEX "ProductPackaging_organizationId_productId_idx" ON "ProductPackaging"("organizationId", "productId");
CREATE UNIQUE INDEX "ProductPackaging_organizationId_barcode_key" ON "ProductPackaging"("organizationId", "barcode");
CREATE INDEX "ProductUomConversion_organizationId_productId_idx" ON "ProductUomConversion"("organizationId", "productId");
CREATE UNIQUE INDEX "ProductUomConversion_organizationId_productId_fromUomId_toU_key" ON "ProductUomConversion"("organizationId", "productId", "fromUomId", "toUomId");
CREATE INDEX "UnitOfMeasure_organizationId_categoryId_idx" ON "UnitOfMeasure"("organizationId", "categoryId");

-- AddForeignKey
ALTER TABLE "UomCategory" ADD CONSTRAINT "UomCategory_referenceUomId_fkey" FOREIGN KEY ("referenceUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UomCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_salesUomId_fkey" FOREIGN KEY ("salesUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_recipeUomId_fkey" FOREIGN KEY ("recipeUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_productionUomId_fkey" FOREIGN KEY ("productionUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductPackaging" ADD CONSTRAINT "ProductPackaging_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductUomConversion" ADD CONSTRAINT "ProductUomConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductUomConversion" ADD CONSTRAINT "ProductUomConversion_fromUomId_fkey" FOREIGN KEY ("fromUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductUomConversion" ADD CONSTRAINT "ProductUomConversion_toUomId_fkey" FOREIGN KEY ("toUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuProduct" ADD CONSTRAINT "MenuProduct_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
