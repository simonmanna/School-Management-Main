import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductCategoryService } from './product-category.service';
import { ProductCategoryController } from './product-category.controller';
import { UomService } from './uom.service';
import { UomController } from './uom.controller';
import { UomCategoryService } from './uom-category.service';
import { UomCategoryController } from './uom-category.controller';
import { UomConversionService } from './uom-conversion.service';
import { TaxService } from './tax.service';
import { TaxController } from './tax.controller';

@Module({
  controllers: [
    ProductController,
    ProductCategoryController,
    UomController,
    UomCategoryController,
    TaxController,
  ],
  providers: [
    ProductService,
    ProductCategoryService,
    UomService,
    UomCategoryService,
    UomConversionService,
    TaxService,
  ],
  exports: [
    ProductService,
    ProductCategoryService,
    UomService,
    UomCategoryService,
    UomConversionService,
    TaxService,
  ],
})
export class ProductModule {}
