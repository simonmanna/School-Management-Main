import { Body, Controller, Get, Param, Post, Patch, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';
import { AssetAssignmentService } from '../services/asset-assignment.service';
import { CreateAssignmentDto } from '../dto/create-assignment.dto';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';

@RequiresModule('fixed-asset')
@Controller('fixed-assets/:assetId/assignments')
export class AssetAssignmentController {
  constructor(private readonly service: AssetAssignmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fixedAsset.read)
  list(@Param('assetId') assetId: string) { return this.service.findByAsset(assetId); }

  @Post()
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  create(@Param('assetId') assetId: string, @Body() dto: CreateAssignmentDto) { return this.service.create(assetId, dto); }

  @Patch(':id/return')
  @RequirePermissions(PERMISSIONS.fixedAsset.update)
  returnAsset(@Param('id') id: string, @Query('returnDate') returnDate: string, @Query('condition') condition?: string) {
    return this.service.returnAsset(id, returnDate, condition);
  }
}
