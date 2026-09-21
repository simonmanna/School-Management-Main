import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ScopedToStudent } from '../../../kernel/auth/guards/scoped-to-student.decorator';
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
  @ScopedToStudent('id')
  balance(@Param('id') id: string) {
    return this.finance.studentBalance(id);
  }

  @Get('students/:id/ledger')
  @RequirePermissions(PERMISSIONS.school.read)
  @ScopedToStudent('id')
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

  /** Accounting trail for fee-produced journal entries (receipts, invoices, settlements). */
  @Get('journal/:id')
  @RequirePermissions(PERMISSIONS.school.read)
  feeJournal(@Param('id') id: string) {
    return this.finance.feeJournal(id);
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

  /* ── B2 · receipts a bursar can find again ── */

  @Get('receipts')
  @RequirePermissions(PERMISSIONS.school.read)
  searchReceipts(
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.finance.searchReceipts({
      q,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('receipts/:id')
  @RequirePermissions(PERMISSIONS.school.read)
  getReceipt(@Param('id') id: string) {
    return this.finance.getReceipt(id);
  }

  /* ── C1 · fee clearance before exams ── */

  @Get('clearance/student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  feeClearance(
    @Param('studentProfileId') studentProfileId: string,
    @Query('thresholdPercent') thresholdPercent?: string,
  ) {
    return this.finance.feeClearance(studentProfileId, {
      thresholdPercent: thresholdPercent ? Number(thresholdPercent) : undefined,
    });
  }

  @Get('clearance/class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  classFeeClearance(@Param('classId') classId: string, @Query('thresholdPercent') thresholdPercent?: string) {
    return this.finance.classFeeClearance(classId, {
      thresholdPercent: thresholdPercent ? Number(thresholdPercent) : undefined,
    });
  }

  /* ── C4 · the statement a parent is handed ── */

  @Get('statement/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  termStatement(@Param('studentProfileId') studentProfileId: string, @Query('termId') termId?: string) {
    return this.finance.termStatement(studentProfileId, termId);
  }

  /**
   * "Why does this pupil owe this?" — the panel a bursar reads out at the
   * window when a parent disputes a balance.
   */
  @Get('explain/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  explainBalance(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.explainBalance(studentProfileId);
  }

  /* ── D2 · instalment progress ── */

  @Get('installments/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  installmentProgress(@Param('studentProfileId') studentProfileId: string, @Query('termId') termId?: string) {
    return this.finance.installmentProgress(studentProfileId, termId);
  }

  /* ── E1 / E2 · reports that leave the screen ── */

  @Get('reports/cash-book')
  @RequirePermissions(PERMISSIONS.school.read)
  dailyCashBook(@Query('date') date?: string) {
    return this.finance.dailyCashBook(date);
  }

  @Get('reports/budget-variance')
  @RequirePermissions(PERMISSIONS.school.read)
  budgetVariance(@Query('termId') termId?: string) {
    return this.finance.budgetVariance(termId);
  }
}
