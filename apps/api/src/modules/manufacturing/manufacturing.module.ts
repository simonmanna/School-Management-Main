import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductModule } from '../core/product/product.module';
import { BomService } from './bom.service';
import { BomController } from './bom.controller';
import { ProductionService } from './production.service';
import { ProductionController } from './production.controller';
import { ProductionRequestService } from './production-request.service';
import { ProductionPlanService } from './production-plan.service';
import { ProductionReportService } from './production-report.service';
import { MrpService } from './mrp.service';
import { ProductionRequestController, ProductionPlanController, ProductionReportController, MrpController } from './request-plan.controller';
import { WorkCenterService, ResourceService, RoutingService } from './masters.service';
import { WorkOrderService } from './work-order.service';
import { ForecastService } from './forecast.service';
import {
  WorkCenterController,
  ResourceController,
  RoutingController,
  WorkOrderController,
  WorkOrderActionController,
} from './phase4.controller';

/**
 * Manufacturing — generic BOM + production orders (the bakery is one config).
 * Reuses the inventory stock/GL engine wholesale: the consume leg is a
 * StockService.issue with moveType production_consume (Dr WIP / Cr Stock
 * Valuation), the output leg a StockService.receive + explicit
 * postProductionOutput (Dr Stock Valuation / Cr WIP). Gated by
 * ENABLE_MANUFACTURING in app.module.ts.
 */
@Module({
  imports: [InventoryModule, ProductModule],
  controllers: [
    BomController,
    ProductionController,
    ProductionRequestController,
    ProductionPlanController,
    ProductionReportController,
    MrpController,
    WorkCenterController,
    ResourceController,
    RoutingController,
    WorkOrderController,
    WorkOrderActionController,
  ],
  providers: [
    BomService,
    ProductionService,
    ProductionRequestService,
    ProductionPlanService,
    ProductionReportService,
    MrpService,
    WorkCenterService,
    ResourceService,
    RoutingService,
    WorkOrderService,
    ForecastService,
  ],
  exports: [BomService, ProductionService, ProductionRequestService, ProductionPlanService, ProductionReportService, MrpService],
})
export class ManufacturingModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'manufacturing',
      version: '2.0.0',
      dependencies: ['core', 'inventory', 'accounting'],
      permissions: [
        ...Object.values(PERMISSIONS.bom),
        ...Object.values(PERMISSIONS.productionOrder),
        ...Object.values(PERMISSIONS.productionRequest),
        ...Object.values(PERMISSIONS.productionPlan),
        ...Object.values(PERMISSIONS.production),
        ...Object.values(PERMISSIONS.workCenter),
        ...Object.values(PERMISSIONS.resource),
        ...Object.values(PERMISSIONS.routing),
        ...Object.values(PERMISSIONS.workOrder),
      ],
    });
  }
}
