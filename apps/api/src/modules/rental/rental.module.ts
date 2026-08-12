import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import { LifecycleRegistry } from '../../kernel/lifecycle/lifecycle.registry';
import { RENTAL_AGREEMENT_LIFECYCLE, RENTAL_UNIT_LIFECYCLE } from './rental-lifecycles';
import { AccountingModule } from '../accounting/accounting.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PosModule } from '../pos/pos.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { RentalController } from './rental.controller';
import { RentalService } from './rental.service';
import { RentalCatalogService } from './rental-catalog.service';
import { RentalLocationConfigService } from './rental-location-config.service';
import { RentalUnitService } from './rental-unit.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalReservationService } from './rental-reservation.service';
import { RentalScoreService } from './rental-score.service';
import { RentalAgreementService } from './rental-agreement.service';
import { RentalDepositService } from './rental-deposit.service';
import { RentalPostingService } from './rental-posting.service';
import { RentalExtensionService } from './rental-extension.service';
import { RentalSwapService } from './rental-swap.service';
import { RentalReturnService } from './rental-return.service';
import { RentalServiceOrderService } from './rental-service-order.service';
import { RentalReportsService } from './rental-reports.service';
import { RentalCronWorker } from './rental-cron.worker';

/**
 * Rental Management — hire-out of serialized and pooled assets.
 *
 * Renting is a second fulfillment verb: possession transfers temporarily, the
 * asset stays owned, and the item comes back on a known date. Checkout is an
 * internal inventory transfer (RENT-STOCK → RENT-OUT) — no COGS, no inventory
 * relief. Fees ride the existing Order → Invoice spine; the deposit is a
 * liability (customer_deposit), never an invoice line.
 */
@Module({
  imports: [AccountingModule, InvoicingModule, InventoryModule, PosModule, ExpensesModule],
  controllers: [RentalController],
  providers: [
    RentalService,
    RentalCatalogService,
    RentalLocationConfigService,
    RentalUnitService,
    RentalAvailabilityService,
    RentalReservationService,
    RentalScoreService,
    RentalAgreementService,
    RentalDepositService,
    RentalPostingService,
    RentalExtensionService,
    RentalSwapService,
    RentalReturnService,
    RentalServiceOrderService,
    RentalReportsService,
    RentalCronWorker,
  ],
  exports: [RentalService],
})
export class RentalModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly lifecycles: LifecycleRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'rental',
      version: '1.0.0',
      dependencies: ['core', 'accounting', 'invoicing', 'inventory', 'pos', 'expenses'],
      permissions: [...Object.values(PERMISSIONS.rental)],
      orderKinds: [{ code: 'rental', label: 'Rental' }],
    });
    this.lifecycles.register(RENTAL_AGREEMENT_LIFECYCLE);
    this.lifecycles.register(RENTAL_UNIT_LIFECYCLE);
  }
}
