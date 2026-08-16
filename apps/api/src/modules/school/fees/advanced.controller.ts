import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { AdvancedFinanceService } from './advanced.service';

/**
 * Advanced school finance endpoints (P1/P2): sponsorships, waivers, fee
 * credits (overpayment/advance/refund carry-forward), sponsor statements, and
 * school AR aging. Credit creation + waiver application are idempotency-safe at
 * the call boundary; the worker guards make re-runs a no-op where applicable.
 */
@Controller('school/finance')
@UseInterceptors(IdempotencyInterceptor)
export class AdvancedFinanceController {
  constructor(private readonly finance: AdvancedFinanceService) {}

  /* Sponsorships */
  @Post('sponsorships')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createSponsorship(@Body() dto: any) {
    return this.finance.createSponsorship(dto);
  }

  @Get('sponsorships')
  @RequirePermissions(PERMISSIONS.school.read)
  listSponsorships(@Query() q: PaginationDto, @Query('studentProfileId') studentProfileId?: string) {
    return this.finance.listSponsorships(studentProfileId);
  }

  @Get('sponsors/:sponsorId/statement')
  @RequirePermissions(PERMISSIONS.school.read)
  sponsorStatement(@Param('sponsorId') sponsorId: string) {
    return this.finance.sponsorStatement(sponsorId);
  }

  /* Waivers */
  @Post('waivers')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createWaiver(@Body() dto: any) {
    return this.finance.createWaiver(dto);
  }

  @Get('waivers')
  @RequirePermissions(PERMISSIONS.school.read)
  listWaivers(@Query('studentProfileId') studentProfileId?: string) {
    return this.finance.listWaivers(studentProfileId);
  }

  @Post('waivers/:id/apply')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  applyWaiver(@Param('id') id: string) {
    return this.finance.applyWaiver(id);
  }

  /* Fee credits */
  @Post('credits')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createCredit(@Body() dto: any) {
    return this.finance.createCredit(dto);
  }

  @Get('credits')
  @RequirePermissions(PERMISSIONS.school.read)
  listCredits(@Query('studentProfileId') studentProfileId?: string) {
    return this.finance.listCredits(studentProfileId);
  }

  @Post('credits/:studentProfileId/apply')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  applyCredits(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.applyCredits(studentProfileId);
  }

  /* Aging (P2) */
  @Get('aging')
  @RequirePermissions(PERMISSIONS.school.read)
  aging(@Query('asOf') asOf?: string) {
    return this.finance.aging(asOf);
  }
}
