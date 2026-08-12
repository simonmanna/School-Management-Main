import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetRevaluationService } from '../services/asset-revaluation.service';
import { CreateRevaluationDto } from '../dto/create-revaluation.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/revaluations')
export class AssetRevaluationController {
  constructor(private readonly service: AssetRevaluationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.create)
  create(@Param('assetId') assetId: string, @Body() dto: CreateRevaluationDto) { return this.service.create(assetId, dto); }
}
