import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { ResourceService, RoutingService, WorkCenterService } from './masters.service';
import { WorkOrderService } from './work-order.service';
import { ProductionReportService } from './production-report.service';
import {
  AssignWorkOrderDto,
  CompleteWorkOrderDto,
  CreateResourceDto,
  CreateRoutingDto,
  CreateWorkCenterDto,
} from './dto/phase4.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@RequiresModule('manufacturing')
@Controller('manufacturing/work-centers')
export class WorkCenterController {
  constructor(private readonly svc: WorkCenterService, private readonly reports: ProductionReportService) {}

  @Get() @RequirePermissions(PERMISSIONS.workCenter.read) list() { return this.svc.list(); }
  @Get('capacity') @RequirePermissions(PERMISSIONS.workCenter.read) capacity() { return this.reports.capacity(); }
  @Post() @RequirePermissions(PERMISSIONS.workCenter.create) create(@Body() dto: CreateWorkCenterDto) { return this.svc.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.workCenter.update) update(@Param('id') id: string, @Body() dto: Partial<CreateWorkCenterDto>) { return this.svc.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.workCenter.delete) async remove(@Param('id') id: string) { await this.svc.remove(id); }
}

@Controller('manufacturing/resources')
export class ResourceController {
  constructor(private readonly svc: ResourceService) {}

  @Get() @RequirePermissions(PERMISSIONS.resource.read) list(@Query('kind') kind?: string) { return this.svc.list({ kind }); }
  @Post() @RequirePermissions(PERMISSIONS.resource.create) create(@Body() dto: CreateResourceDto) { return this.svc.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.resource.update) update(@Param('id') id: string, @Body() dto: Partial<CreateResourceDto>) { return this.svc.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.resource.delete) async remove(@Param('id') id: string) { await this.svc.remove(id); }
}

@Controller('manufacturing/routings')
export class RoutingController {
  constructor(private readonly svc: RoutingService) {}

  @Get() @RequirePermissions(PERMISSIONS.routing.read) list(@Query('bomId') bomId?: string, @Query('productId') productId?: string) { return this.svc.list({ bomId, productId }); }
  @Get(':id') @RequirePermissions(PERMISSIONS.routing.read) get(@Param('id') id: string) { return this.svc.get(id); }
  @Post() @RequirePermissions(PERMISSIONS.routing.create) create(@Body() dto: CreateRoutingDto) { return this.svc.create(dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.routing.delete) async remove(@Param('id') id: string) { await this.svc.remove(id); }
}

@Controller('manufacturing/production-orders/:orderId/work-orders')
export class WorkOrderController {
  constructor(private readonly svc: WorkOrderService) {}

  @Get() @RequirePermissions(PERMISSIONS.workOrder.read) list(@Param('orderId') orderId: string) { return this.svc.list(orderId); }
  @Post('generate') @RequirePermissions(PERMISSIONS.workOrder.manage) generate(@Param('orderId') orderId: string) { return this.svc.generateForOrder(orderId); }
}

@Controller('manufacturing/work-orders')
export class WorkOrderActionController {
  constructor(private readonly svc: WorkOrderService) {}

  @Patch(':id/assign') @RequirePermissions(PERMISSIONS.workOrder.manage) assign(@Param('id') id: string, @Body() dto: AssignWorkOrderDto) { return this.svc.assign(id, dto); }
  @Post(':id/start') @RequirePermissions(PERMISSIONS.workOrder.manage) start(@Param('id') id: string) { return this.svc.start(id); }
  @Post(':id/pause') @RequirePermissions(PERMISSIONS.workOrder.manage) pause(@Param('id') id: string) { return this.svc.pause(id); }
  @Post(':id/complete') @RequirePermissions(PERMISSIONS.workOrder.manage) complete(@Param('id') id: string, @Body() dto: CompleteWorkOrderDto) { return this.svc.complete(id, dto); }
}
