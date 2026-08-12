import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetInsuranceService } from '../services/asset-insurance.service';
import { CreateInsuranceDto } from '../dto/create-insurance.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/insurance')
export class AssetInsuranceController {
  constructor(private readonly service: AssetInsuranceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateInsuranceDto) { return this.service.create(assetId, dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  update(@Param('id') id: string, @Body() dto: Partial<CreateInsuranceDto>) { return this.service.update(id, dto); }
}
