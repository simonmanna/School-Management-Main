import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { AccountingModule } from '../../accounting/accounting.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import {
  DiscountService,
  FeeScheduleService,
  FeeStructureService,
  InstallmentPlanService,
  PenaltyRuleService,
  PenaltyRunService,
  ScholarshipService,
  StudentFeeAssignmentService,
} from './catalog.service';
import {
  DiscountController,
  FeeScheduleController,
  FeeStructureController,
  InstallmentPlanController,
  PenaltyRuleController,
  PenaltyRunController,
  ScholarshipController,
  StudentFeeAssignmentController,
} from './catalog.controller';
import { BillingService, SchoolPaymentService } from './billing.service';
import { AdvancedFinanceService } from './advanced.service';
import { BillingController, SchoolPaymentController } from './billing.controller';
import { AdvancedFinanceController } from './advanced.controller';
import { PenaltyCronWorker } from './penalty-cron.worker';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';

/**
 * The Fees module depends on DocumentBuilderService + PostingService +
 * AccountDeterminationService to post invoices to the GL and resolve the
 * counter-account on payments. These are provided by InvoicingModule and
 * AccountingModule, so this module imports them directly — Nest resolves
 * providers through a module's own `imports`, not through sibling modules that
 * merely happen to be loaded at AppModule level. (The fork's comment claimed
 * the latter; it never booted with school enabled. This was the "DI wiring
 * issue" that kept the module disabled.)
 *
 * On bootstrap the PenaltyCronWorker self-schedules a daily assessment of
 * overdue fee schedules (see PENALTY_RUN_INTERVAL_HOURS / PENALTY_CRON_ENABLED).
 */
@Module({
  imports: [InvoicingModule, AccountingModule],
  controllers: [
    FeeStructureController,
    FeeScheduleController,
    StudentFeeAssignmentController,
    DiscountController,
    ScholarshipController,
    InstallmentPlanController,
    PenaltyRuleController,
    PenaltyRunController,
    BillingController,
    SchoolPaymentController,
    AdvancedFinanceController,
    BudgetController,
  ],
  providers: [
    FeeStructureService,
    FeeScheduleService,
    StudentFeeAssignmentService,
    DiscountService,
    ScholarshipService,
    InstallmentPlanService,
    PenaltyRuleService,
    PenaltyRunService,
    BillingService,
    SchoolPaymentService,
    AdvancedFinanceService,
    PenaltyCronWorker,
    BudgetService,
  ],
  exports: [
    FeeStructureService,
    FeeScheduleService,
    StudentFeeAssignmentService,
    DiscountService,
    ScholarshipService,
    InstallmentPlanService,
    PenaltyRuleService,
    PenaltyRunService,
    BillingService,
    SchoolPaymentService,
    AdvancedFinanceService,
    PenaltyCronWorker,
  ],
})
export class FeesModule implements OnApplicationBootstrap {
  // Manually wire the PenaltyCronWorker here so its onApplicationBootstrap
  // fires (NestJS only invokes lifecycle hooks on instances it owns).
  // We don't need any DI gymnastics — the constructor params are auto-wired
  // because we listed `PenaltyCronWorker` in `providers` above.
  constructor(public readonly penaltyWorker: PenaltyCronWorker) {}

  onApplicationBootstrap(): void {
    // PenaltyCronWorker.onApplicationBootstrap registers itself.
    // We just hold a reference so this class instantiates the worker.
    void this.penaltyWorker;
  }
}