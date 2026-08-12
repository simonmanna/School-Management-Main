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
import { PartnerCategoryService } from './partner-category.service';
import { IsOptional, IsString } from 'class-validator';

class CreatePartnerCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string;
}

class UpdatePartnerCategoryDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() parentId?: string;
}

@Controller('partner-categories')
export class PartnerCategoryController {
  constructor(private readonly categories: PartnerCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.partnerCategory.read)
  list(@Query() query: PaginationDto) {
    return this.categories.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.partnerCategory.read)
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.partnerCategory.create)
  create(@Body() dto: CreatePartnerCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.partnerCategory.update)
  update(@Param('id') id: string, @Body() dto: UpdatePartnerCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.partnerCategory.delete)
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}