import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { UseInterceptors } from '@nestjs/common';
import { PeriodCloseService } from './period-close.service';

@Controller('fiscal-periods')
@UseInterceptors(IdempotencyInterceptor)
export class PeriodCloseController {
  constructor(private readonly periodClose: PeriodCloseService) {}

  @Post(':id/close')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.fiscalPeriod.update)
  close(@Param('id') id: string) {
    return this.periodClose.close(id);
  }

  @Post(':id/lock')
  @Idempotent()
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.fiscalPeriod.update)
  lock(@Param('id') id: string) {
    return this.periodClose.lock(id);
  }
}