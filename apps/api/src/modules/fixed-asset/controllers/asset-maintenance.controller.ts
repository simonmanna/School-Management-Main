import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetMaintenanceService } from '../services/asset-maintenance.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateMaintenanceDto } from '../dto/create-maintenance.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/maintenance')
export class AssetMaintenanceController {
  constructor(
    private readonly service: AssetMaintenanceService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Get('due')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  due() { return this.service.getDueMaintenance(this.tenant.organizationId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateMaintenanceDto) { return this.service.create(assetId, dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  update(@Param('id') id: string, @Body() dto: Partial<CreateMaintenanceDto>) { return this.service.update(id, dto); }
}
