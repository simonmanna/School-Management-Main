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
import { AccountResolverService } from './posting/account-resolver.service';
import { AccountingBootstrapModule } from './coa/accounting-bootstrap.module';
import { seedAccountCategories } from './coa/account-category-seeder';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { AccountCategoryController } from './account-category/account-category.controller';
import { AccountCategoryService } from './account-category/account-category.service';
import { PostingService } from './posting/posting.service';
import { JournalEntryService } from './journal-entry/journal-entry.service';
import { JournalEntryController } from './journal-entry/journal-entry.controller';
import { BankAccountService } from './treasury/bank-account.service';
import { TreasuryService } from './treasury/treasury.service';
import { TreasuryController } from './treasury/treasury.controller';
import { CashFlowService } from './treasury/cash-flow.service';
import { CashFlowController } from './treasury/cash-flow.controller';
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
import { ReportsDashboardController } from './reporting/reports-dashboard.controller';
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
import { ExportController } from './reporting/export.controller';
import { CostCenterController } from './cost-center/cost-center.controller';
import { CostCenterService } from './cost-center/cost-center.service';
import { FiscalPeriodCrudController } from './posting/fiscal-period-crud.controller';
import { InventoryValuationController } from './reporting/inventory-valuation.controller';

/**
 * Phase 2 — the financial engine. Exports PostingService + account
 * determination so higher modules (invoicing, POS, payroll...) post through it.
 */
@Module({
  imports: [AccountingBootstrapModule],
  controllers: [
    CashFlowController,
    AccountController,
    AccountCategoryController,
    JournalController,
    AccountMappingController,
    JournalEntryController,
    TreasuryController,
    CashRegisterController,
    CashSessionController,
    PeriodCloseController,
    FiscalPeriodCrudController,
    CostCenterController,
    InventoryValuationController,
    CurrencyController,
    BankReconciliationController,
    AccountingReportingController,
    ReportsDashboardController,
    ExportController,
  ],
  providers: [
    AccountService,
    JournalService,
    AccountMappingService,
    FiscalPeriodService,
    AccountCategoryService,
    AccountResolverService,
    AccountDeterminationService,
    PostingService,
    JournalEntryService,
    BankAccountService,
    TreasuryService,
    CashFlowService,
    BankReconciliationService,
    CashRegisterService,
    CashSessionService,
    PeriodCloseService,
    CostCenterService,
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
      JournalService,
      AccountCategoryService,
    AccountResolverService,
    AccountDeterminationService,
    FiscalPeriodService,
    CashSessionService,
    CashRegisterService,
    PeriodCloseService,
    CurrencyService,
    RevaluationService,
    BankReconciliationService,
    SnapshotRebuildService,
    TieOutService,
  ],
})
export class AccountingModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly prisma: PrismaService,
    private readonly accounts: AccountResolverService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'accounting',
      version: '1.3.0',
      dependencies: ['core'],
      permissions: [
        ...Object.values(PERMISSIONS.account) as string[],
        ...Object.values(PERMISSIONS.journal) as string[],
        ...Object.values(PERMISSIONS.journalEntry) as string[],
        ...Object.values(PERMISSIONS.accountMapping) as string[],
        ...Object.values(PERMISSIONS.bankAccount) as string[],
        ...Object.values(PERMISSIONS.treasury) as string[],
        ...Object.values(PERMISSIONS.cashRegister) as string[],
        ...Object.values(PERMISSIONS.cashSession) as string[],
        ...Object.values(PERMISSIONS.fiscalPeriod) as string[],
        ...Object.values(PERMISSIONS.costCenter) as string[],
      ],
    });

    // Account categories are GLOBAL and system-managed — one row per accounting
    // concept, shared by every tenant, with no tenant CRUD. Seed them once at
    // boot rather than per organization. Version-gated, so re-running is a
    // no-op. Fire-and-forget, mirroring CoreModule's permission sync.
    setImmediate(() => {
      seedAccountCategories(this.prisma.raw)
        .then(() => this.accounts.reloadCategories())
        .catch((e) =>
          // eslint-disable-next-line no-console
          console.warn('[AccountingModule] account category seed failed:', e?.message ?? e),
        );
    });
  }
}
