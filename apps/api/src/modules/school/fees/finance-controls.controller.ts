import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { FinanceControlsService } from './finance-controls.service';
import { PaymentAllocationReversalService } from './allocation-reversal.service';

@Controller('school/finance')
@UseInterceptors(IdempotencyInterceptor)
export class FinanceControlsController {
  constructor(
    private readonly controls: FinanceControlsService,
    private readonly reversals: PaymentAllocationReversalService,
  ) {}

  /* ── Adjustments ── */

  @Get('adjustments')
  @RequirePermissions(PERMISSIONS.school.read)
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
  @RequirePermissions(PERMISSIONS.school.read)
  closeStatus(@Param('termId') termId: string) {
    return this.controls.getTermCloseStatus(termId);
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
   * REFUND (elsewhere) returns money that genuinely arrived. All three are
   * gated on approveRefunds because each changes what a family owes.
   */

  @Post('allocations/:id/reverse')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveRefunds)
  reverseAllocation(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.reversals.reverseAllocation(id, body?.reason);
  }

  @Post('payments/:id/reallocate')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveRefunds)
  reallocate(
    @Param('id') id: string,
    @Body() body: { allocations: Array<{ documentId: string; amount: number }>; reason: string },
  ) {
    return this.reversals.reallocate(id, body?.allocations ?? [], body?.reason);
  }

  @Post('payments/:id/reverse')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveRefunds)
  reversePayment(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.reversals.reversePayment(id, body?.reason);
  }
}
