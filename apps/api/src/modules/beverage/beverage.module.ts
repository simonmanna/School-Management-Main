import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { InventoryModule } from '../inventory/inventory.module';
import { BeverageCountService } from './beverage-count.service';
import { BeverageCountController } from './beverage-count.controller';
import { BeverageReportService } from './beverage-report.service';
import { BeverageReportController } from './beverage-report.controller';

/**
 * Beverage Control — digital-weight alcohol measurement (bar shrinkage control).
 * A separate, alcohol-only feature that reuses the inventory adjustment → ledger
 * → GL → audit pipeline (via {@link InventoryModule}'s StockDocService).
 */
@Module({
  imports: [InventoryModule],
  controllers: [BeverageCountController, BeverageReportController],
  providers: [BeverageCountService, BeverageReportService],
  exports: [BeverageCountService, BeverageReportService],
})
export class BeverageModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'beverage',
      version: '1.0.0',
      dependencies: ['core', 'inventory', 'accounting'],
      permissions: [...Object.values(PERMISSIONS.beverage)],
    });
  }
}
