import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { ProductionRequestService } from './production-request.service';
import { ProductionPlanService } from './production-plan.service';
import { ProductionReportService } from './production-report.service';
import { MrpService } from './mrp.service';
import { ForecastService } from './forecast.service';
import {
  AddPlanLinesDto,
  CreateProductionPlanDto,
  CreateProductionRequestDto,
  RejectProductionRequestDto,
} from './dto/request.dto';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

@RequiresModule('manufacturing')
@Controller('manufacturing/requests')
export class ProductionRequestController {
  constructor(private readonly requests: ProductionRequestService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.productionRequest.read)
  list(@Query('status') status?: string) {
    return this.requests.list({ status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.productionRequest.read)
  get(@Param('id') id: string) {
    return this.requests.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.productionRequest.create)
  create(@Body() dto: CreateProductionRequestDto) {
    return this.requests.create(dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.productionRequest.submit)
  submit(@Param('id') id: string) {
    return this.requests.submit(id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.productionRequest.approve)
  approve(@Param('id') id: string) {
    return this.requests.approve(id);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.productionRequest.reject)
  reject(@Param('id') id: string, @Body() dto: RejectProductionRequestDto) {
    return this.requests.reject(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.productionRequest.create)
  cancel(@Param('id') id: string) {
    return this.requests.cancel(id);
  }
}

@Controller('manufacturing/plans')
export class ProductionPlanController {
  constructor(private readonly plans: ProductionPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.productionPlan.read)
  list(@Query('status') status?: string) {
    return this.plans.list({ status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.productionPlan.read)
  get(@Param('id') id: string) {
    return this.plans.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.productionPlan.create)
  create(@Body() dto: CreateProductionPlanDto) {
    return this.plans.create(dto);
  }

  @Post(':id/lines')
  @RequirePermissions(PERMISSIONS.productionPlan.update)
  addLines(@Param('id') id: string, @Body() dto: AddPlanLinesDto) {
    return this.plans.addLines(id, dto);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.productionPlan.confirm)
  confirm(@Param('id') id: string) {
    return this.plans.confirm(id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.productionPlan.update)
  cancel(@Param('id') id: string) {
    return this.plans.cancel(id);
  }
}

@Controller('manufacturing/reports')
export class ProductionReportController {
  constructor(private readonly reports: ProductionReportService, private readonly forecast: ForecastService) {}

  @Get('forecast')
  @RequirePermissions(PERMISSIONS.production.report)
  demandForecast(@Query('weeks') weeks?: string, @Query('targetDate') targetDate?: string) {
    return this.forecast.forecast({ weeks: weeks ? Number(weeks) : undefined, targetDate });
  }

  @Get('wip-reconciliation')
  @RequirePermissions(PERMISSIONS.production.report)
  wip() {
    return this.reports.wipReconciliation();
  }

  @Get('kpis')
  @RequirePermissions(PERMISSIONS.production.report)
  kpis(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.kpis({ from, to });
  }

  @Get('genealogy/backward/:orderId')
  @RequirePermissions(PERMISSIONS.production.report)
  backward(@Param('orderId') orderId: string) {
    return this.reports.genealogyBackward(orderId);
  }

  @Get('genealogy/forward/:productId')
  @RequirePermissions(PERMISSIONS.production.report)
  forward(@Param('productId') productId: string) {
    return this.reports.genealogyForward(productId);
  }

  @Get('shortage/:productId')
  @RequirePermissions(PERMISSIONS.production.report)
  shortage(@Param('productId') productId: string, @Query('qty') qty?: string, @Query('locationId') locationId?: string) {
    return this.reports.shortage(productId, Number(qty ?? 1), locationId);
  }

  @Get('trends')
  @RequirePermissions(PERMISSIONS.production.report)
  trends(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.trends({ from, to });
  }

  @Get('yield-by-bom')
  @RequirePermissions(PERMISSIONS.production.report)
  yieldByBom(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.yieldByBom({ from, to });
  }

  @Get('ingredient-usage')
  @RequirePermissions(PERMISSIONS.production.report)
  ingredientUsage(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.ingredientUsage({ from, to });
  }

  @Get('capacity')
  @RequirePermissions(PERMISSIONS.production.report)
  capacity() {
    return this.reports.capacity();
  }
}

@Controller('manufacturing/mrp')
export class MrpController {
  constructor(private readonly mrp: MrpService) {}

  @Post('from-document/:id')
  @RequirePermissions(PERMISSIONS.productionRequest.create)
  fromDocument(@Param('id') id: string) {
    return this.mrp.raiseFromDocument(id);
  }

  @Post('scan-min-stock')
  @RequirePermissions(PERMISSIONS.productionRequest.create)
  scanMinStock() {
    return this.mrp.scanMinStock();
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.productionPlan.confirm)
  run() {
    return this.mrp.runMrp();
  }
}
