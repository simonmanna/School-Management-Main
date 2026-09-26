import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { AccountingModule } from '../../accounting/accounting.module';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';
import {
  DiscountService,
  FeeCategoryService,
  FeeScheduleService,
  FeeStructureService,
  InstallmentPlanService,
  PenaltyRuleService,
  PenaltyRunService,
  ScholarshipService,
  StudentFeeAssignmentService,
  StudentOptionalFeeService,
} from './catalog.service';
import {
  DiscountController,
  FeeCategoryController,
  FeeScheduleController,
  FeeStructureController,
  InstallmentPlanController,
  PenaltyRuleController,
  PenaltyRunController,
  ScholarshipController,
  StudentFeeAssignmentController,
  StudentOptionalFeeController,
} from './catalog.controller';
import { BillingService, SchoolPaymentService } from './billing.service';
import { RefundRequestService } from './refund-request.service';
import { FinanceCorrectionRequestService } from './finance-correction-request.service';
import { AdvancedFinanceService } from './advanced.service';
import { BillingController, SchoolPaymentController } from './billing.controller';
import { AdvancedFinanceController } from './advanced.controller';
import { PenaltyCronWorker } from './penalty-cron.worker';
import { BudgetService } from './budget.service';
import { BudgetController } from './budget.controller';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { PaymentAllocationReversalService } from './allocation-reversal.service';
import { FeeNotificationsSubscriber } from './fee-notifications.subscriber';
import { MobileMoneyService } from './mobile-money.service';
import { DunningCronWorker } from './dunning-cron.worker';
import { MobileMoneyController } from './mobile-money.controller';
import { SchoolFinanceQueryController } from './school-finance-query.controller';
import { FinanceControlsService } from './finance-controls.service';
import { FinanceControlsController } from './finance-controls.controller';
import { BillingRunService } from './billing-run.service';
import { BillingRunController } from './billing-run.controller';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentReconciliationController } from './payment-reconciliation.controller';

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
  // PlacementLookupModule: billing resolves a learner class from placement
  // history rather than the StudentProfile projection (ADR-027).
  imports: [InvoicingModule, AccountingModule, PlacementLookupModule],
  controllers: [
    MobileMoneyController,
    FeeStructureController,
    FeeCategoryController,
    FeeScheduleController,
    StudentFeeAssignmentController,
    StudentOptionalFeeController,
    DiscountController,
    ScholarshipController,
    InstallmentPlanController,
    PenaltyRuleController,
    PenaltyRunController,
    BillingController,
    SchoolPaymentController,
    AdvancedFinanceController,
    BudgetController,
    SchoolFinanceQueryController,
    FinanceControlsController,
    BillingRunController,
    PaymentReconciliationController,
  ],
  providers: [
    FeeStructureService,
    FeeCategoryService,
    FeeScheduleService,
    StudentFeeAssignmentService,
    StudentOptionalFeeService,
    DiscountService,
    ScholarshipService,
    InstallmentPlanService,
    PenaltyRuleService,
    PenaltyRunService,
    BillingService,
    SchoolPaymentService,
    RefundRequestService,
    FinanceCorrectionRequestService,
    AdvancedFinanceService,
    PenaltyCronWorker,
    BudgetService,
    SchoolFinanceQueryService,
    PaymentAllocationReversalService,
    // C2/C3: fee events → guardian SMS. The messaging service already existed;
    // attendance was using it and fees had no subscriber at all.
    FeeNotificationsSubscriber,
    // Live MTN MoMo / Airtel collection. Funnels every confirmed callback into
    // SchoolPaymentService.collect — one payment writer, not two.
    MobileMoneyService,
    // Automated reminder ladder. Off unless DUNNING_CRON_ENABLED=true — SMS
    // costs money and an unwanted reminder is worse than none.
    DunningCronWorker,
    FinanceControlsService,
    BillingRunService,
    PaymentReconciliationService,
  ],
  exports: [
    FeeStructureService,
    FeeCategoryService,
    FeeScheduleService,
    StudentFeeAssignmentService,
    StudentOptionalFeeService,
    DiscountService,
    ScholarshipService,
    InstallmentPlanService,
    PenaltyRuleService,
    PenaltyRunService,
    BillingService,
    SchoolPaymentService,
    AdvancedFinanceService,
    PenaltyCronWorker,
    SchoolFinanceQueryService,
    PaymentAllocationReversalService,
    // C2/C3: fee events → guardian SMS. The messaging service already existed;
    // attendance was using it and fees had no subscriber at all.
    FeeNotificationsSubscriber,
    // Live MTN MoMo / Airtel collection. Funnels every confirmed callback into
    // SchoolPaymentService.collect — one payment writer, not two.
    MobileMoneyService,
    // Automated reminder ladder. Off unless DUNNING_CRON_ENABLED=true — SMS
    // costs money and an unwanted reminder is worse than none.
    DunningCronWorker,
    FinanceControlsService,
    BillingRunService,
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