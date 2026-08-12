import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetRepairService } from '../services/asset-repair.service';
import { CreateRepairDto } from '../dto/create-repair.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/repairs')
export class AssetRepairController {
  constructor(private readonly service: AssetRepairService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateRepairDto) { return this.service.create(assetId, dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  update(@Param('id') id: string, @Body() dto: Partial<CreateRepairDto>) { return this.service.update(id, dto); }
}
