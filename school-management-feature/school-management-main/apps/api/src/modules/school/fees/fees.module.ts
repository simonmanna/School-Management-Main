import { Module, OnApplicationBootstrap } from '@nestjs/common';
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
import { BillingController, SchoolPaymentController } from './billing.controller';
import { PenaltyCronWorker } from './penalty-cron.worker';

/**
 * The Fees module depends on DocumentBuilderService + PostingService +
 * AccountDeterminationService to post invoices to the GL and resolve the
 * counter-account on payments. These live in the InvoicingModule +
 * AccountingModule, which are imported as siblings at AppModule level.
 *
 * On bootstrap the PenaltyCronWorker registers itself with the kernel's
 * CronRunnerService so overdue fee schedules are assessed daily (see
 * PENALTY_RUN_HOUR_UTC / PENALTY_RUN_INTERVAL_HOURS env vars).
 */
@Module({
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
    PenaltyCronWorker,
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