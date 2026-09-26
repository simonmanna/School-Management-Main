import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { FinanceControlsService } from './finance-controls.service';
import { FinanceCorrectionRequestService } from './finance-correction-request.service';
import { FinanceReasonDto, ReallocatePaymentDto } from './dto.types';

@Controller('school/finance')
@UseInterceptors(IdempotencyInterceptor)
export class FinanceControlsController {
  constructor(
    private readonly controls: FinanceControlsService,
    private readonly corrections: FinanceCorrectionRequestService,
  ) {}

  /* ── Adjustments ── */

  @Get('adjustments')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listAdjustments(@Query('studentProfileId') studentProfileId?: string, @Query('status') status?: string) {
    return this.controls.listAdjustments(studentProfileId, status);
  }

  @Post('adjustments')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createAdjustment(
    @Body() dto: { studentProfileId: string; documentId: string; direction: 'debit' | 'credit'; amount: number; reason: string },
  ) {
    return this.controls.createAdjustment(dto);
  }

  @Post('adjustments/:id/approve')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveAdjustments)
  approveAdjustment(@Param('id') id: string) {
    return this.controls.approveAdjustment(id);
  }

  @Post('adjustments/:id/reject')
  @RequirePermissions(PERMISSIONS.school.approveAdjustments)
  rejectAdjustment(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.controls.rejectAdjustment(id, body?.reason);
  }

  /* ── Term financial close ── */

  @Get('terms/:termId/close-status')
  @RequirePermissions(PERMISSIONS.school.readFees)
  closeStatus(@Param('termId') termId: string) {
    return this.controls.getTermCloseStatus(termId);
  }

  /** Term-scoped totals exactly as a close would freeze them. */
  @Get('terms/:termId/close-preview')
  @RequirePermissions(PERMISSIONS.school.readFees)
  closePreview(@Param('termId') termId: string) {
    return this.controls.termTotalsSnapshot(termId);
  }

  @Post('terms/:termId/close')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.closePeriod)
  closeTerm(@Param('termId') termId: string) {
    return this.controls.closeTerm(termId);
  }

  @Post('terms/:termId/reopen')
  @RequirePermissions(PERMISSIONS.school.closePeriod)
  reopenTerm(@Param('termId') termId: string, @Body() body: { reason?: string }) {
    return this.controls.reopenTerm(termId, body?.reason);
  }

  /* ── Reversals (Phase 3) ──
   *
   * Three separate operations, not one. Reversing an ALLOCATION moves no cash;
   * reversing a PAYMENT unwinds a receipt that never should have existed; a
   * REFUND (elsewhere) returns money that genuinely arrived.
   *
   * D4 (re-audit #3, 2026-09-25): each is maker-checker. The bursar (refund
   * permission) requests, a different refund approver releases; a caller with
   * both applies it at once, logged as an override. The route needs fee read
   * access only; FinanceCorrectionRequestService decides who is which side.
   */

  @Post('allocations/:id/reverse')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.readFees)
  reverseAllocation(@Param('id') id: string, @Body() body: FinanceReasonDto) {
    return this.corrections.submit({ kind: 'reverse_allocation', allocationId: id, reason: body?.reason });
  }

  @Post('payments/:id/reallocate')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.readFees)
  reallocate(@Param('id') id: string, @Body() body: ReallocatePaymentDto) {
    return this.corrections.submit({ kind: 'reallocate', paymentId: id, allocations: body?.allocations ?? [], reason: body?.reason });
  }

  @Post('payments/:id/reverse')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.readFees)
  reversePayment(@Param('id') id: string, @Body() body: FinanceReasonDto) {
    return this.corrections.submit({ kind: 'reverse_payment', paymentId: id, reason: body?.reason });
  }

  @Get('corrections')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listCorrections(@Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.corrections.list(status ?? 'pending');
  }

  @Post('corrections/:id/approve')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.readFees)
  approveCorrection(@Param('id') id: string, @Body() body: { comment?: string }) {
    return this.corrections.approve(id, body?.comment);
  }

  @Post('corrections/:id/reject')
  @RequirePermissions(PERMISSIONS.school.readFees)
  rejectCorrection(@Param('id') id: string, @Body() body: FinanceReasonDto) {
    return this.corrections.reject(id, body?.reason);
  }
}
