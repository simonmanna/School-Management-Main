import { Module } from '@nestjs/common';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { AccountingModule } from '../../accounting/accounting.module';
import { InventoryModule } from '../../inventory/inventory.module';
import {
  MealProgramService,
  MealTypeService,
  MealEntitlementService,
  MealAssignmentService,
} from './meal-config.service';
import {
  MealProgramController,
  MealTypeController,
  MealEntitlementController,
  MealAssignmentController,
} from './meal-config.controller';
import { MealSessionService } from './meal-session.service';
import { MealSessionController } from './meal-session.controller';
import { MealMenuService } from './meal-menu.service';
import { MealMenuController } from './meal-menu.controller';
import { MealWalletService } from './meal-wallet.service';
import { MealWalletController } from './meal-wallet.controller';
import { MealBillingService } from './meal-billing.service';
import { MealBillingController } from './meal-billing.controller';
import { MealKitchenService } from './meal-kitchen.service';
import { MealReportsService } from './meal-reports.service';
import { MealReportsController } from './meal-reports.controller';

/**
 * School Meals module (Meals V1–V3). Operations (V1), wallet ledger + GL (V1.5/
 * V2), term billing (V2) and kitchen/inventory (V3). Money reuses Document/
 * Payment/Posting (InvoicingModule + AccountingModule); stock reuses Inventory.
 */
@Module({
  imports: [InvoicingModule, AccountingModule, InventoryModule],
  controllers: [
    MealProgramController,
    MealTypeController,
    MealEntitlementController,
    MealAssignmentController,
    MealSessionController,
    MealMenuController,
    MealWalletController,
    MealBillingController,
    MealKitchenController,
    MealReportsController,
  ],
  providers: [
    MealProgramService,
    MealTypeService,
    MealEntitlementService,
    MealAssignmentService,
    MealSessionService,
    MealMenuService,
    MealWalletService,
    MealBillingService,
    MealKitchenService,
    MealReportsService,
  ],
  exports: [
    MealProgramService,
    MealTypeService,
    MealAssignmentService,
    MealSessionService,
    MealWalletService,
    MealBillingService,
    MealKitchenService,
  ],
})
export class MealsModule {}
