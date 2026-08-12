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
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { UomCategoryService } from './uom-category.service';

class CreateUomCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() referenceUomId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateUomCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() referenceUomId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('uom-categories')
export class UomCategoryController {
  constructor(private readonly categories: UomCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.uomCategory.read)
  list(@Query() query: PaginationDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.uomCategory.read)
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.uomCategory.create)
  create(@Body() dto: CreateUomCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.uomCategory.update)
  update(@Param('id') id: string, @Body() dto: UpdateUomCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.uomCategory.delete)
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
