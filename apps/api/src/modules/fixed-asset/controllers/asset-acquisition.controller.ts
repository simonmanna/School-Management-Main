import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetAcquisitionService } from '../services/asset-acquisition.service';
import { CreateAcquisitionDto } from '../dto/create-acquisition.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/acquisition')
export class AssetAcquisitionController {
  constructor(private readonly service: AssetAcquisitionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  find(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  upsert(@Param('assetId') assetId: string, @Body() dto: CreateAcquisitionDto) { return this.service.upsert(assetId, dto); }

  @Delete()
  @RequirePermissions(PERMISSIONS.fixedAsset.delete)
  remove(@Param('assetId') assetId: string) { return this.service.remove(assetId); }
}
