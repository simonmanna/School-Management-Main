import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { LifecycleRegistry } from '../../kernel/lifecycle/lifecycle.registry';
import { REPAIR_ORDER_LIFECYCLE } from './repair-lifecycles';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { NotificationsModule } from '../../kernel/notifications/notifications.module';
import { RepairController } from './repair.controller';
import { RepairService } from './repair.service';
import { RepairCatalogService } from './repair-catalog.service';
import { RepairDiagnosisService } from './repair-diagnosis.service';
import { RepairJobService } from './repair-job.service';
import { RepairPartsService } from './repair-parts.service';
import { RepairWarrantyService } from './repair-warranty.service';
import { RepairContractService } from './repair-contract.service';
import { RepairReportsService } from './repair-reports.service';
import { RepairPostingService } from './repair-posting.service';
import { RepairCronWorker } from './repair-cron.worker';

/**
 * Repair & Maintenance Management (RMMS) — generic vertical.
 *
 * One engine, four modes: customer-item repair, own-asset maintenance, SLA
 * contract maintenance and preventive maintenance (cron-generated orders).
 * The spine (RepairOrder → items → diagnosis → quotation → jobs → parts →
 * invoice) rides the existing Order → Invoice spine for billing and the
 * inventory StockService for parts consumption.
 */
@Module({
  imports: [AccountingModule, InvoicingModule, InventoryModule, PosModule, NotificationsModule],
  controllers: [RepairController],
  providers: [
    RepairService,
    RepairCatalogService,
    RepairDiagnosisService,
    RepairJobService,
    RepairPartsService,
    RepairWarrantyService,
    RepairContractService,
    RepairReportsService,
    RepairPostingService,
    RepairCronWorker,
  ],
  exports: [RepairService, RepairPostingService],
})
export class RepairModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly lifecycles: LifecycleRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'repair',
      version: '1.0.0',
      dependencies: ['core', 'accounting', 'invoicing', 'inventory', 'pos'],
      permissions: [...Object.values(PERMISSIONS.repair)],
      orderKinds: [{ code: 'repair', label: 'Repair' }],
    });
    this.lifecycles.register(REPAIR_ORDER_LIFECYCLE);
  }
}
