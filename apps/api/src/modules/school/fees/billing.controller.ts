import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { BillingService, SchoolPaymentService } from './billing.service';
import { RefundRequestService } from './refund-request.service';
// Value import (not `import type`): the global ValidationPipe needs the runtime
// class to read class-validator metadata; `import type` would erase it.
import { CollectFeePaymentDto, GenerateBillingDto, RefundFeeDto } from './dto.types';

/**
 * Bursar endpoints. All money-mutating endpoints are idempotent: the
 * IdempotencyInterceptor reads the `Idempotency-Key` header and replays
 * the cached response if the same key+body is seen again. This is
 * critical for mobile-money retries.
 */
@Controller('school/billing')
@UseInterceptors(IdempotencyInterceptor)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('generate')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  generate(@Body() dto: GenerateBillingDto) {
    return this.billing.generateForTerm(dto);
  }

  @Post('penalty-run/:scheduleId')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  penaltyRun(@Param('scheduleId') id: string) {
    return this.billing.generatePenaltyRun(id);
  }
}

@Controller('school/payments')
@UseInterceptors(IdempotencyInterceptor)
export class SchoolPaymentController {
  constructor(
    private readonly payments: SchoolPaymentService,
    private readonly refunds: RefundRequestService,
  ) {}

  @Post('collect')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  collect(@Body() dto: CollectFeePaymentDto) {
    return this.payments.collect(dto);
  }

  /**
   * Paying money OUT is maker-checker. With only the refund permission this
   * files a request (`status: 'pending_approval'`); a holder of the approve
   * permission — a different person — releases it below. Requiring BOTH here
   * (the guard ANDs its list) meant no preset could ever refund (E2E audit P1).
   * A caller holding both, e.g. an Administrator, still refunds in one step.
   */
  @Post('refund')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.refundFees)
  refund(@Body() dto: RefundFeeDto) {
    return this.refunds.submit(dto);
  }

  @Get('refund-requests')
  @RequirePermissions(PERMISSIONS.school.readFees)
  refundRequests(@Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.refunds.list(status ?? 'pending');
  }

  @Post('refund-requests/:id/approve')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveRefunds)
  approveRefund(@Param('id') id: string, @Body('comment') comment?: string) {
    return this.refunds.approve(id, comment);
  }

  @Post('refund-requests/:id/reject')
  @RequirePermissions(PERMISSIONS.school.approveRefunds)
  rejectRefund(@Param('id') id: string, @Body('reason') reason: string) {
    return this.refunds.reject(id, reason);
  }

  /**
   * B4 · reporting day. A whole class of receipts in one submission.
   *
   * Deliberately NOT @Idempotent at the batch level: each row carries its own
   * `externalReference` replay guard, and a bursar re-submitting a corrected
   * batch after three rows failed must have the other rows replay rather than
   * the whole request return a cached response for a body it no longer sends.
   */
  @Post('collect-batch')
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  collectBatch(
    @Body()
    dto: {
      rows: Array<{
        studentProfileId: string;
        amount: number;
        paymentMethod?: 'cash' | 'bank' | 'mobile_money' | 'card';
        reference?: string;
        externalReference?: string;
        convertOverpaymentToCredit?: boolean;
      }>;
      paymentDate?: string;
      cashSessionId?: string;
      bankAccountId?: string;
    },
  ) {
    return this.payments.collectBatch(dto);
  }
}