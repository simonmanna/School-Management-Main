import { Body, Controller, Param, Post, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { BillingService, SchoolPaymentService } from './billing.service';
// Value import (not `import type`): the global ValidationPipe needs the runtime
// class to read class-validator metadata; `import type` would erase it.
import { CollectFeePaymentDto, GenerateBillingDto } from './dto.types';

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
}