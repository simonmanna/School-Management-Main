import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetDisposalService } from '../services/asset-disposal.service';
import { CreateDisposalDto } from '../dto/create-disposal.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/disposal')
export class AssetDisposalController {
  constructor(private readonly service: AssetDisposalService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  find(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.dispose)
  create(@Param('assetId') assetId: string, @Body() dto: CreateDisposalDto) { return this.service.create(assetId, dto); }
}
