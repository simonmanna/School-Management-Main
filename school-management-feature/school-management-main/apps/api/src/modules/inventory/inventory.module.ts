import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { LocationService } from './location.service';
import { StockService } from './stock.service';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryController } from './inventory.controller';
import { CostResolverService } from './costing/cost-resolver.service';
import { StockPostingService } from './posting/stock-posting.service';

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController],
  providers: [LocationService, StockService, InventoryQueryService, CostResolverService, StockPostingService],
  exports: [LocationService, StockService, InventoryQueryService, CostResolverService, StockPostingService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'inventory',
      version: '1.1.0',
      dependencies: ['core', 'accounting'],
      permissions: [
        ...Object.values(PERMISSIONS.inventoryLocation),
        ...Object.values(PERMISSIONS.inventory),
      ],
    });
  }
}
