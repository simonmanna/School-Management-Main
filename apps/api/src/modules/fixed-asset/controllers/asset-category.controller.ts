import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetCategoryService } from '../services/asset-category.service';
import { CreateAssetCategoryDto } from '../dto/create-asset-category.dto';
import { UpdateAssetCategoryDto } from '../dto/update-asset-category.dto';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('asset-categories')
export class AssetCategoryController {
  constructor(private readonly service: AssetCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.assetCategory.read)
  list(@Query() query: PaginationDto) { return this.service.list(query); }

  @Get('all')
  @RequirePermissions(PERMISSIONS.assetCategory.read)
  findAll() { return this.service.findAll(); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.assetCategory.read)
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.assetCategory.create)
  create(@Body() dto: CreateAssetCategoryDto) { return this.service.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.assetCategory.update)
  update(@Param('id') id: string, @Body() dto: UpdateAssetCategoryDto) { return this.service.update(id, dto); }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.assetCategory.delete)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
