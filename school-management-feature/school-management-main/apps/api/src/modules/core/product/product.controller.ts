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
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.product.read)
  list(@Query() query: PaginationDto) {
    return this.products.list(query);
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
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
