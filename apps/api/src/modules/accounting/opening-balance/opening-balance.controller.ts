import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { CreateOpeningBalancesDto, OpeningBalanceService } from './opening-balance.service';

@Controller('opening-balances')
@UseInterceptors(IdempotencyInterceptor)
export class OpeningBalanceController {
  constructor(private readonly openingBalances: OpeningBalanceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.journalEntry.read)
  summary() {
    return this.openingBalances.summary();
  }

  /** Maker: stage the load as a draft; a second person posts it from the journal-entry screen. */
  @Post()
  @Idempotent()
  @RequirePermissions(PERMISSIONS.journalEntry.create)
  stage(@Body() dto: CreateOpeningBalancesDto) {
    return this.openingBalances.stage(dto);
  }
}
