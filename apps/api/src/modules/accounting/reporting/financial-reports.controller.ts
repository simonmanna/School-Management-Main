import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { FinancialReportsService } from './financial-reports.service';

const bool = (v?: string): boolean => v === 'true' || v === '1';

const ids = (v?: string): string[] | undefined => {
  if (!v) return undefined;
  const list = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
};

/**
 * The detailed accounting report suite, served under `reports/accounting/*`
 * alongside the snapshot-backed statements in AccountingReportingController.
 * Everything here is gated on `report:accounting`.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/accounting')
@RequirePermissions(PERMISSIONS.report.accounting)
export class FinancialReportsController {
  constructor(private readonly reports: FinancialReportsService) {}

  @Get('extended-trial-balance')
  extendedTrialBalance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.reports.extendedTrialBalance({ from, to }, { includeZero: bool(includeZero) });
  }

  @Get('income-statement')
  incomeStatement(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compare') compare?: string,
  ) {
    return this.reports.incomeStatement({ from, to }, { compare: compare !== 'false' });
  }

  @Get('balance-sheet/comparative')
  comparativeBalanceSheet(@Query('asOf') asOf?: string, @Query('compareAsOf') compareAsOf?: string) {
    return this.reports.comparativeBalanceSheet(asOf, compareAsOf);
  }

  @Get('general-ledger/detailed')
  detailedGeneralLedger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountIds') accountIds?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reports.detailedGeneralLedger(
      { from, to },
      { accountIds: ids(accountIds), page: Number(page) || 1, pageSize: Number(pageSize) || 25 },
    );
  }

  @Get('journal-report')
  journalReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('journalId') journalId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reports.journalReport(
      { from, to },
      { journalId, status, page: Number(page) || 1, pageSize: Number(pageSize) || 50 },
    );
  }

  @Get('partner-ledger')
  partnerLedger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: 'receivable' | 'payable',
    @Query('partnerId') partnerId?: string,
    @Query('detail') detail?: string,
  ) {
    return this.reports.partnerLedger(
      { from, to },
      { type, partnerId, detail: bool(detail) || Boolean(partnerId) },
    );
  }

  @Get('cash-book')
  cashBook(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashBook({ from, to });
  }

  @Get('tax-summary')
  taxSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.taxSummary({ from, to });
  }

  @Get('revenue-analysis')
  revenueAnalysis(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.revenueAnalysis({ from, to });
  }

  @Get('expense-analysis')
  expenseAnalysis(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.expenseAnalysis({ from, to });
  }

  @Get('equity-statement')
  equityStatement(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.equityStatement({ from, to });
  }

  @Get('financial-ratios')
  financialRatios(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.financialRatios({ from, to });
  }

  @Get('account-balances')
  accountBalances(@Query('asOf') asOf?: string, @Query('includeZero') includeZero?: string) {
    return this.reports.accountBalances(asOf, { includeZero: bool(includeZero) });
  }
}
