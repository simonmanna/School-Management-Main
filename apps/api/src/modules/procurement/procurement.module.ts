import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { CoreModule } from '../core/core.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';

import { PurchaseRequestsService } from './purchase-requests.service';
import { PurchaseRequestsController } from './purchase-requests.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { DebitNotesService } from './debit-notes.service';
import { DebitNotesController } from './debit-notes.controller';

/**
 * Procurement module (Phase F.6).
 *
 * Owns the buy-side chain: PurchaseRequest → PurchaseOrder → GoodsReceiptNote.
 * Vendor bills are created through InvoicingModule (vendor_bill document) and
 * linked back via VendorBillLink. ThreeWayMatch reconciles quantities and
 * prices; status=blocked lines require an AP override before the bill can post.
 *
 * Debit notes also live here because they are the buy-side counterpart of
 * credit notes (supplier-issued or customer-issued).
 */
@Module({
  imports: [CoreModule, AccountingModule, InventoryModule, InvoicingModule],
  controllers: [
    PurchaseRequestsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    DebitNotesController,
  ],
  providers: [
    PurchaseRequestsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    DebitNotesService,
  ],
  exports: [
    PurchaseOrdersService,
    PurchaseRequestsService,
    GoodsReceiptsService,
    DebitNotesService,
  ],
})
export class ProcurementModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'procurement',
      version: '1.0.0',
      dependencies: ['core', 'accounting', 'inventory', 'invoicing'],
      permissions: [
        'purchase_request:create',
        'purchase_request:read',
        'purchase_request:update',
        'purchase_request:delete',
        'purchase_request:approve',
        'purchase_request:submit',
        'purchase_order:create',
        'purchase_order:read',
        'purchase_order:update',
        'purchase_order:delete',
        'purchase_order:cancel',
        'purchase_order:receive',
        'purchase_order:pay',
        'goods_receipt:create',
        'goods_receipt:read',
        'debit_note:create',
        'debit_note:read',
        'debit_note:post',
        'debit_note:cancel',
      ],
    });
  }
}
