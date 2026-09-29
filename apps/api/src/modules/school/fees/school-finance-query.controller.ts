import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ScopedToStudent } from '../../../kernel/auth/guards/scoped-to-student.decorator';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { FeeReceiptPdfService } from './fee-receipt-pdf.service';

/**
 * Read-side finance endpoints backed by the canonical query service (A1/A6/B1).
 * Every figure a bursar, parent or dashboard sees comes through here, so they
 * cannot disagree.
 */
@Controller('school/finance')
export class SchoolFinanceQueryController {
  constructor(
    private readonly finance: SchoolFinanceQueryService,
    private readonly receipts: FeeReceiptPdfService,
  ) {}

  @Get('students/:id/balance')
  @RequirePermissions(PERMISSIONS.school.readFees)
  @ScopedToStudent('id')
  balance(@Param('id') id: string) {
    return this.finance.studentBalance(id);
  }

  @Get('students/:id/ledger')
  @RequirePermissions(PERMISSIONS.school.readFees)
  @ScopedToStudent('id')
  ledger(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.finance.studentLedger(id, { from, to });
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  getInvoice(@Param('id') id: string) {
    return this.finance.getInvoice(id);
  }

  /** Accounting trail for fee-produced journal entries (receipts, invoices, settlements). */
  @Get('journal/:id')
  @RequirePermissions(PERMISSIONS.school.readFees)
  feeJournal(@Param('id') id: string) {
    return this.finance.feeJournal(id);
  }

  @Get('reconciliation/ar-gl')
  @RequirePermissions(PERMISSIONS.school.readFees)
  reconcileArGl() {
    return this.finance.reconcileCurrentArToGl();
  }

  @Get('reconciliation/credit-liability')
  @RequirePermissions(PERMISSIONS.school.readFees)
  reconcileCreditLiability() {
    return this.finance.reconcileCreditLiability();
  }

  /**
   * ADR-013's Gate 1/4: every cached projection equals the subledger behind it.
   * An empty `drifted` array is the gate passing.
   */
  @Get('reconciliation/cached-projections')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  reconcileOperationalCash() {
    return this.finance.reconcileOperationalCash();
  }

  /* ── B2 · receipts a bursar can find again ── */

  @Get('receipts')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  getReceipt(@Param('id') id: string) {
    return this.finance.getReceipt(id);
  }

  /**
   * Wave 16: printable receipt — `format=a4` (A5 landscape, for the parent and
   * the file) or `format=thermal` (80 mm roll). Every print after the first is
   * stamped as a copy on the paper.
   */
  @Get('receipts/:id/pdf')
  @RequirePermissions(PERMISSIONS.school.readFees)
  async receiptPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @Query('format') format?: string) {
    const { filename, pdf } = await this.receipts.generate(id, format === 'thermal' ? 'thermal' : 'a4');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': pdf.length });
    return new StreamableFile(pdf);
  }

  /* ── C1 · fee clearance before exams ── */

  @Get('clearance/student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  feeClearance(
    @Param('studentProfileId') studentProfileId: string,
    @Query('thresholdPercent') thresholdPercent?: string,
  ) {
    return this.finance.feeClearance(studentProfileId, {
      thresholdPercent: thresholdPercent ? Number(thresholdPercent) : undefined,
    });
  }

  @Get('clearance/class/:classId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  classFeeClearance(@Param('classId') classId: string, @Query('thresholdPercent') thresholdPercent?: string) {
    return this.finance.classFeeClearance(classId, {
      thresholdPercent: thresholdPercent ? Number(thresholdPercent) : undefined,
    });
  }

  /* ── C4 · the statement a parent is handed ── */

  @Get('statement/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  termStatement(@Param('studentProfileId') studentProfileId: string, @Query('termId') termId?: string) {
    return this.finance.termStatement(studentProfileId, termId);
  }

  /**
   * "Why does this pupil owe this?" — the panel a bursar reads out at the
   * window when a parent disputes a balance.
   */
  @Get('explain/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  explainBalance(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.explainBalance(studentProfileId);
  }

  /* ── D2 · instalment progress ── */

  @Get('installments/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  installmentProgress(@Param('studentProfileId') studentProfileId: string, @Query('termId') termId?: string) {
    return this.finance.installmentProgress(studentProfileId, termId);
  }

  /* ── E1 / E2 · reports that leave the screen ── */

  @Get('reports/cash-book')
  @RequirePermissions(PERMISSIONS.school.readFees)
  dailyCashBook(@Query('date') date?: string) {
    return this.finance.dailyCashBook(date);
  }

  @Get('reports/budget-variance')
  @RequirePermissions(PERMISSIONS.school.readFees)
  budgetVariance(@Query('termId') termId?: string) {
    return this.finance.budgetVariance(termId);
  }
}
