import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetTransferService } from '../services/asset-transfer.service';
import { CreateTransferDto } from '../dto/create-transfer.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/transfers')
export class AssetTransferController {
  constructor(private readonly service: AssetTransferService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.transfer)
  create(@Param('assetId') assetId: string, @Body() dto: CreateTransferDto) { return this.service.create(assetId, dto); }
}
