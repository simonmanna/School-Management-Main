import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AccountingReportingService } from './accounting-reporting.service';
import { PnLReportService } from './pnl-report.service';
import { BalanceSheetReportService } from './balance-sheet-report.service';
import { CashFlowReportService } from './cash-flow-report.service';
import { TieOutService } from './tieout.service';
import { SnapshotRebuildService } from './snapshots/snapshot-rebuild.service';

@Controller('reports/accounting')
@RequirePermissions(PERMISSIONS.report.accounting)
export class AccountingReportingController {
  constructor(
    private readonly reporting: AccountingReportingService,
    private readonly pnl: PnLReportService,
    private readonly balanceSheet: BalanceSheetReportService,
    private readonly cashFlow: CashFlowReportService,
    private readonly tieOut: TieOutService,
    private readonly snapshots: SnapshotRebuildService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('trial-balance')
  trialBalance(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.trialBalance({ from, to });
  }

  @Get('account-ledger/:accountId')
  accountLedger(
    @Param('accountId') accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.accountLedger(accountId, { from, to });
  }

  @Get('general-ledger')
  generalLedger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.reporting.generalLedger({ from, to }, Number(page) || 1, 100);
  }

  @Get('profit-and-loss')
  profitAndLoss(@Query('from') from?: string, @Query('to') to?: string) {
    return this.pnl.pnl({ from, to });
  }

  @Get('balance-sheet')
  balanceSheetReport(@Query('asOf') asOf: string) {
    return this.balanceSheet.balanceSheet(asOf);
  }

  @Get('cash-flow')
  cashFlowReport(@Query('from') from?: string, @Query('to') to?: string) {
    return this.cashFlow.cashFlow({ from, to });
  }

  @Get('tieout')
  tieout(@Query('asOf') asOf?: string) {
    return this.tieOut.latest(asOf);
  }

  /** Operator-triggered: rebuild the snapshot for the current org now. */
  @Post('rebuild-snapshots')
  async rebuildSnapshots() {
    const asOf = new Date();
    const organizationId = this.tenant.organizationId;
    await this.snapshots.rebuildForOrg(organizationId, asOf);
    await this.tieOut.run(organizationId, asOf);
    return { rebuiltAt: asOf };
  }
}
