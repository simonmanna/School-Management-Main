import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.product.read)
  list(@Query() query: ProductQueryDto) {
    return this.products.list(query);
  }

  @Get('search')
  @RequirePermissions(PERMISSIONS.product.read)
  search(@Query('q') q: string, @Query('pageSize') pageSize?: string) {
    return this.products.search(q, pageSize ? Number(pageSize) : 20);
  }

  /** Resolve a scanned barcode to a product + base-unit quantity (1 for the base
   *  barcode, or the pack size for a packaging barcode). Null if not found. */
  @Get('resolve-barcode')
  @RequirePermissions(PERMISSIONS.product.read)
  resolveBarcode(@Query('code') code: string) {
    return this.products.resolveBarcode(code);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.product.read)
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.product.create)
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.product.update)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.product.delete)
  remove(@Param('id') id: string) { return this.products.remove(id); }

  @Patch(':id/restore')
  @RequirePermissions(PERMISSIONS.product.update)
  restore(@Param('id') id: string) { return this.products.restore(id); }
}
