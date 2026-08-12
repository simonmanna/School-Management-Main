import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetInspectionService } from '../services/asset-inspection.service';
import { CreateInspectionDto } from '../dto/create-inspection.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/inspections')
export class AssetInspectionController {
  constructor(private readonly service: AssetInspectionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateInspectionDto) { return this.service.create(assetId, dto); }
}
