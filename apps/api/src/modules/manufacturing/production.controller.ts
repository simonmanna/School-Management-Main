import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { ProductionService } from './production.service';
import {
  CancelProductionDto,
  CompleteProductionDto,
  CreateProductionOrderDto,
  RecordQcDto,
  StartProductionDto,
} from './dto/production.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@RequiresModule('manufacturing')
@Controller('manufacturing/production-orders')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.productionOrder.read)
  list(@Query('status') status?: string, @Query('outputProductId') outputProductId?: string) {
    return this.production.list({ status, outputProductId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.productionOrder.read)
  get(@Param('id') id: string) {
    return this.production.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.productionOrder.create)
  create(@Body() dto: CreateProductionOrderDto) {
    return this.production.createOrder(dto);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.productionOrder.create)
  confirm(@Param('id') id: string) {
    return this.production.confirmOrder(id);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.productionOrder.start)
  start(@Param('id') id: string, @Body() dto: StartProductionDto) {
    return this.production.startOrder(id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.productionOrder.complete)
  complete(@Param('id') id: string, @Body() dto: CompleteProductionDto) {
    return this.production.completeOrder(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.productionOrder.cancel)
  cancel(@Param('id') id: string, @Body() dto: CancelProductionDto) {
    return this.production.cancelOrder(id, dto);
  }

  @Post(':id/qc')
  @RequirePermissions(PERMISSIONS.productionOrder.qc)
  recordQc(@Param('id') id: string, @Body() dto: RecordQcDto) {
    return this.production.recordQc(id, dto);
  }

  @Post(':id/reverse')
  @RequirePermissions(PERMISSIONS.productionOrder.cancel)
  reverse(@Param('id') id: string, @Body() dto: CancelProductionDto) {
    return this.production.reverseOrder(id, dto);
  }

  // Phase 5 — make a finished good sellable at POS in one click.
  @Post('finished-goods/:productId/menu-item')
  @RequirePermissions(PERMISSIONS.productionOrder.create)
  createMenuItem(@Param('productId') productId: string) {
    return this.production.createMenuItemForProduct(productId);
  }
}
