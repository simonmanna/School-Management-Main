import { Module, OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';

import { AccountService } from './account/account.service';
import { AccountController } from './account/account.controller';
import { JournalService } from './journal/journal.service';
import { JournalController } from './journal/journal.controller';
import { AccountMappingService } from './account-mapping/account-mapping.service';
import { AccountMappingController } from './account-mapping/account-mapping.controller';
import { FiscalPeriodService } from './posting/fiscal-period.service';
import { AccountDeterminationService } from './posting/account-determination.service';
import { PostingService } from './posting/posting.service';
import { JournalEntryService } from './journal-entry/journal-entry.service';
import { JournalEntryController } from './journal-entry/journal-entry.controller';
import { BankAccountService } from './treasury/bank-account.service';
import { TreasuryService } from './treasury/treasury.service';
import { TreasuryController } from './treasury/treasury.controller';
import { BankReconciliationService } from './treasury/bank-reconciliation.service';
import { BankReconciliationController } from './treasury/bank-reconciliation.controller';
import { CashRegisterService } from './treasury/cash-register.service';
import { CashRegisterController } from './treasury/cash-register.controller';
import { CashSessionService } from './treasury/cash-session.service';
import { CashSessionController } from './treasury/cash-session.controller';
import { PeriodCloseService } from './posting/period-close.service';
import { PeriodCloseController } from './posting/period-close.controller';
import { AccountingReportingService } from './reporting/accounting-reporting.service';
import { AccountingReportingController } from './reporting/accounting-reporting.controller';
import { PnLReportService } from './reporting/pnl-report.service';
import { BalanceSheetReportService } from './reporting/balance-sheet-report.service';
import { CashFlowReportService } from './reporting/cash-flow-report.service';
import { TieOutService } from './reporting/tieout.service';
import { SnapshotRebuildService } from './reporting/snapshots/snapshot-rebuild.service';
import { SnapshotCronWorker } from './reporting/snapshot-cron.worker';
import { CurrencyService } from './currency/currency.service';
import { CurrencyController } from './currency/currency.controller';
import { RevaluationService } from './currency/revaluation.service';
import { AccountingWorkflowsInitializer } from './workflows/accounting-workflows.initializer';

/**
 * Phase 2 — the financial engine. Exports PostingService + account
 * determination so higher modules (invoicing, POS, payroll...) post through it.
 */
@Module({
  controllers: [
    AccountController,
    JournalController,
    AccountMappingController,
    JournalEntryController,
    TreasuryController,
    CashRegisterController,
    CashSessionController,
    PeriodCloseController,
    CurrencyController,
    BankReconciliationController,
    AccountingReportingController,
  ],
  providers: [
    AccountService,
    JournalService,
    AccountMappingService,
    FiscalPeriodService,
    AccountDeterminationService,
    PostingService,
    JournalEntryService,
    BankAccountService,
    TreasuryService,
    BankReconciliationService,
    CashRegisterService,
    CashSessionService,
    PeriodCloseService,
    CurrencyService,
    RevaluationService,
    AccountingReportingService,
    PnLReportService,
    BalanceSheetReportService,
    CashFlowReportService,
    TieOutService,
    SnapshotRebuildService,
    SnapshotCronWorker,
    AccountingWorkflowsInitializer,
  ],
  exports: [
    PostingService,
    AccountDeterminationService,
    FiscalPeriodService,
    CashSessionService,
    PeriodCloseService,
    CurrencyService,
    RevaluationService,
    BankReconciliationService,
    SnapshotRebuildService,
    TieOutService,
  ],
})
export class AccountingModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistry) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'accounting',
      version: '1.2.0',
      dependencies: ['core'],
      permissions: [
        ...Object.values(PERMISSIONS.account),
        ...Object.values(PERMISSIONS.journal),
        ...Object.values(PERMISSIONS.journalEntry),
        ...Object.values(PERMISSIONS.accountMapping),
        ...Object.values(PERMISSIONS.bankAccount),
        ...Object.values(PERMISSIONS.treasury),
        ...Object.values(PERMISSIONS.cashRegister),
        ...Object.values(PERMISSIONS.cashSession),
      ],
    });
  }
}
