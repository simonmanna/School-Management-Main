import { Body, Controller, Param, Post, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { BillingService, SchoolPaymentService } from './billing.service';
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
  constructor(private readonly payments: SchoolPaymentService) {}

  @Post('collect')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  collect(@Body() dto: CollectFeePaymentDto) {
    return this.payments.collect(dto);
  }

  // Phase 0: paying money OUT now requires an approval permission in addition
  // to the operational refund permission. P0-6 showed the payment engine's
  // overpayment guard never fires on a customer refund, so until A2.1 moves the
  // canonical entitlement check into the engine itself, the authorisation
  // boundary is doing the work.
  @Post('refund')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.refundFees, PERMISSIONS.school.approveRefunds)
  refund(@Body() dto: RefundFeeDto) {
    return this.payments.refundFee(dto);
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