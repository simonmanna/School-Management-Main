import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductCategoryService } from './product-category.service';
import { ProductCategoryController } from './product-category.controller';
import { UomService } from './uom.service';
import { UomController } from './uom.controller';
import { TaxService } from './tax.service';
import { TaxController } from './tax.controller';

@Module({
  controllers: [ProductController, ProductCategoryController, UomController, TaxController],
  providers: [ProductService, ProductCategoryService, UomService, TaxService],
  exports: [ProductService, ProductCategoryService, UomService, TaxService],
})
export class ProductModule {}
