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
import { ProductCategoryService } from './product-category.service';
import { IsOptional, IsString } from 'class-validator';

class CreateProductCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() incomeAccountId?: string;
  @IsOptional() @IsString() expenseAccountId?: string;
}

class UpdateProductCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() incomeAccountId?: string;
  @IsOptional() @IsString() expenseAccountId?: string;
}

@Controller('product-categories')
export class ProductCategoryController {
  constructor(private readonly categories: ProductCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.productCategory.read)
  list(@Query() query: PaginationDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.productCategory.read)
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.productCategory.create)
  create(@Body() dto: CreateProductCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.productCategory.update)
  update(@Param('id') id: string, @Body() dto: UpdateProductCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.productCategory.delete)
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}