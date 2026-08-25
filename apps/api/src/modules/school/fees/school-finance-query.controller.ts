import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { SchoolFinanceQueryService } from './school-finance-query.service';

/**
 * Read-side finance endpoints backed by the canonical query service (A1/A6/B1).
 * Every figure a bursar, parent or dashboard sees comes through here, so they
 * cannot disagree.
 */
@Controller('school/finance')
export class SchoolFinanceQueryController {
  constructor(private readonly finance: SchoolFinanceQueryService) {}

  @Get('students/:id/balance')
  @RequirePermissions(PERMISSIONS.school.read)
  balance(@Param('id') id: string) {
    return this.finance.studentBalance(id);
  }

  @Get('students/:id/ledger')
  @RequirePermissions(PERMISSIONS.school.read)
  ledger(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.finance.studentLedger(id, { from, to });
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.school.read)
  listInvoices(
    @Query('studentProfileId') studentProfileId?: string,
    @Query('termId') termId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.finance.listInvoices({ studentProfileId, termId, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.school.read)
  getInvoice(@Param('id') id: string) {
    return this.finance.getInvoice(id);
  }

  @Get('reconciliation/ar-gl')
  @RequirePermissions(PERMISSIONS.school.read)
  reconcileArGl() {
    return this.finance.reconcileCurrentArToGl();
  }

  @Get('reconciliation/credit-liability')
  @RequirePermissions(PERMISSIONS.school.read)
  reconcileCreditLiability() {
    return this.finance.reconcileCreditLiability();
  }

  /**
   * ADR-013's Gate 1/4: every cached projection equals the subledger behind it.
   * An empty `drifted` array is the gate passing.
   */
  @Get('reconciliation/cached-projections')
  @RequirePermissions(PERMISSIONS.school.read)
  reconcileCachedProjections() {
    return this.finance.reconcileCachedProjections();
  }

  /**
   * Cash custody, operational half: Payment vs CashMovement. Must be
   * zero-variance at every instant — unlike bank/mobile-money settlement, which
   * legitimately lags and is reported separately so a timing difference is
   * never mistaken for an accounting defect.
   */
  @Get('reconciliation/operational-cash')
  @RequirePermissions(PERMISSIONS.school.read)
  reconcileOperationalCash() {
    return this.finance.reconcileOperationalCash();
  }
}
