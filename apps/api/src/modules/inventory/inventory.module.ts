import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProductModule } from '../core/product/product.module';
import { LocationService } from './location.service';
import { StockService } from './stock.service';
import { StockDocService } from './stock-doc.service';
import { DirectStockService } from './direct-stock.service';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryController } from './inventory.controller';
import { InventoryCountService } from './inventory-count.service';
import { InventoryCountController } from './inventory-count.controller';
import { CostResolverService } from './costing/cost-resolver.service';
import { StockPostingService } from './posting/stock-posting.service';
import { StockReservationService } from './stock-reservation.service';
import { StockReservationController } from './stock-reservation.controller';
import { InventoryPostingRuleService } from './posting/posting-rule.service';
import { InventoryPostingRuleControllerService } from './posting/posting-rule.controller';
import { PostingRuleController } from './posting/posting-rule.http.controller';

@Module({
  imports: [AccountingModule, ProductModule],
  controllers: [InventoryController, InventoryCountController, StockReservationController, PostingRuleController],
  providers: [LocationService, StockService, StockDocService, DirectStockService, InventoryQueryService, InventoryCountService, CostResolverService, StockPostingService, StockReservationService, InventoryPostingRuleService, InventoryPostingRuleControllerService],
  exports: [LocationService, StockService, StockDocService, DirectStockService, InventoryQueryService, InventoryCountService, CostResolverService, StockPostingService, StockReservationService, InventoryPostingRuleService],
})
export class InventoryModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'inventory',
      version: '1.2.0',
      dependencies: ['core', 'accounting'],
      permissions: [
        ...Object.values(PERMISSIONS.inventoryLocation),
        ...Object.values(PERMISSIONS.inventory),
        ...Object.values(PERMISSIONS.inventoryDoc),
        ...Object.values(PERMISSIONS.inventoryCount),
      ],
    });
  }
}
