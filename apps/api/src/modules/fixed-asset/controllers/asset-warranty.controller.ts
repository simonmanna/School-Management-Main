import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetWarrantyService } from '../services/asset-warranty.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateWarrantyDto } from '../dto/create-warranty.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/warranties')
export class AssetWarrantyController {
  constructor(
    private readonly service: AssetWarrantyService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Get('expiring')
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  expiring(@Query('days') days?: string) {
    return this.service.getExpiringWarranties(this.tenant.organizationId, Number(days) || 90);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateWarrantyDto) { return this.service.create(assetId, dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  update(@Param('id') id: string, @Body() dto: Partial<CreateWarrantyDto>) { return this.service.update(id, dto); }
}
