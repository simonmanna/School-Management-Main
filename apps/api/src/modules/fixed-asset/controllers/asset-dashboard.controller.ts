import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetDashboardService } from '../services/asset-dashboard.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets-dashboard')
export class AssetDashboardController {
  constructor(
    private readonly service: AssetDashboardService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  summary() { return this.service.getSummary(this.tenant.organizationId); }

  @Get('upcoming')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  upcoming() { return this.service.getUpcoming(this.tenant.organizationId); }

  @Get('reports/:type')
  @RequirePermissions(PERMISSIONS.assetReport.read)
  reports(@Param('type') type: string) { return this.service.getReports(this.tenant.organizationId, type); }
}
