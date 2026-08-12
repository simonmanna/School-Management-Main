import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetService } from '../services/asset.service';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { UpdateAssetDto } from '../dto/update-asset.dto';
import { AssetQueryDto } from '../dto/asset-query.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets')
export class AssetController {
  constructor(private readonly service: AssetService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Query() query: AssetQueryDto) { return this.service.list(query); }

  @Get('search')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  search(@Query('q') q: string) { return this.service.search(q); }

  @Get('by-code/:code')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  findByCode(@Param('code') code: string) { return this.service.findByCode(code); }

  @Get('by-barcode/:barcode')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  findByBarcode(@Param('barcode') barcode: string) { return this.service.findByBarcode(barcode); }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  dashboard() { return this.service.getDashboard(); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Body() dto: CreateAssetDto) { return this.service.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) { return this.service.update(id, dto); }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.fixedAsset.delete)
  remove(@Param('id') id: string) { return this.service.remove(id); }

  @Patch(':id/restore')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  restore(@Param('id') id: string) { return this.service.restore(id); }
}
