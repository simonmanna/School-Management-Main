import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Generic back-office Orders — Order CRUD over the shared domain-neutral
 * `Order` aggregate, independent of the POS terminal. Staff can raise orders
 * for retail, phone orders, and other generic flows; line items come from the
 * org's menus (café/bar/restaurant) or product catalog (retail) depending on
 * the org's `orders.lineSource` config (auto → follows POS `posMode`).
 *
 * Pricing, numbering and lifecycle reuse the existing spines:
 *  - `DocumentBuilderService.prepareLines` (tax engine) prices menu AND product
 *    lines identically — no duplicated tax math.
 *  - `SequenceService` on the shared `order:YYYYMMDD` key → ORD- numbers stay
 *    globally unique with POS orders.
 *  - `WorkflowService` (`entityType: 'order'`, registered by PosModule) drives
 *    cancel/reopen with the same guards (notBilled).
 *  - Billing delegates to `PosInvoiceService.generateInvoice` (stock + AR).
 *
 * No own orderKinds are contributed: generic orders are ordinary `sale` orders
 * (the transactionKind default already registered by the POS module).
 */
@Module({
  imports: [AccountingModule, InvoicingModule, InventoryModule, PosModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'orders',
      version: '1.0.0',
      dependencies: ['accounting', 'invoicing', 'inventory', 'pos'],
      permissions: [...Object.values(PERMISSIONS.orders)],
    });
  }
}