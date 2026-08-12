import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetCheckInOutService } from '../services/asset-checkinout.service';
import { CreateCheckInOutDto } from '../dto/create-checkinout.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/checkinout')
export class AssetCheckInOutController {
  constructor(private readonly service: AssetCheckInOutService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateCheckInOutDto) { return this.service.create(assetId, dto); }

  @Patch(':id/checkin')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  checkIn(@Param('id') id: string, @Query('returnDate') returnDate: string, @Query('condition') condition?: string) {
    return this.service.checkIn(id, returnDate, condition);
  }
}
