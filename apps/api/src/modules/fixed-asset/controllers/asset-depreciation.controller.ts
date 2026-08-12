import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetDepreciationService } from '../services/asset-depreciation.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { RunDepreciationDto } from '../dto/run-depreciation.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/depreciation')
export class AssetDepreciationController {
  constructor(
    private readonly service: AssetDepreciationService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.assetDepreciation.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Get('period/:period')
  @RequirePermissions(PERMISSIONS.assetDepreciation.read)
  byPeriod(@Param('period') period: string) {
    return this.service.findByPeriod(this.tenant.organizationId, period);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.assetDepreciation.run)
  run(@Body() dto: RunDepreciationDto) {
    return this.service.run(this.tenant.organizationId, dto);
  }

  @Post(':id/post')
  @RequirePermissions(PERMISSIONS.assetDepreciation.run)
  postEntry(@Param('id') id: string) { return this.service.postEntry(id); }
}
