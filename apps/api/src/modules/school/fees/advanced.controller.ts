import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { AdvancedFinanceService } from './advanced.service';
import { FeeNotificationsSubscriber } from './fee-notifications.subscriber';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * Advanced school finance endpoints (P1/P2): sponsorships, waivers, fee
 * credits (overpayment/advance/refund carry-forward), sponsor statements, and
 * school AR aging. Credit creation + waiver application are idempotency-safe at
 * the call boundary; the worker guards make re-runs a no-op where applicable.
 */
@Controller('school/finance')
@UseInterceptors(IdempotencyInterceptor)
export class AdvancedFinanceController {
  constructor(
    private readonly finance: AdvancedFinanceService,
    private readonly feeNotifications: FeeNotificationsSubscriber,
    private readonly tenant: TenantContextService,
  ) {}

  /* ── Sponsorships (Phase 5: contained, not production-ready) ──
   *
   * Sponsorship records a sponsor, a student and a cap, and produces a
   * statement — but nothing collects money FROM a sponsor. Collections land on
   * the STUDENT's AR, so the subledger cannot say which portion a sponsor paid,
   * and the cap has no consumption to enforce against.
   *
   * Until the sponsor-payment path exists (SponsorshipCommitment → sponsor
   * invoice → sponsor payment settling student AR), these endpoints are gated
   * off by default. The gate is HERE, at the controller: hiding the tab in the
   * web app is presentation, not a control, and any client can call the API
   * directly.
   */
  private assertSponsorshipEnabled() {
    if (process.env.SCHOOL_SPONSORSHIP_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Sponsorship is not production-ready and is disabled. It records a cap it cannot enforce ' +
          'and cannot attribute collections to a sponsor, because no sponsor-payment path exists. ' +
          'Set SCHOOL_SPONSORSHIP_ENABLED=true only in a non-production environment.',
      );
    }
  }

  @Post('sponsorships')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createSponsorship(@Body() dto: any) {
    this.assertSponsorshipEnabled();
    return this.finance.createSponsorship(dto);
  }

  @Get('sponsorships')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listSponsorships(@Query() q: PaginationDto, @Query('studentProfileId') studentProfileId?: string) {
    this.assertSponsorshipEnabled();
    return this.finance.listSponsorships(studentProfileId);
  }

  @Get('sponsors/:sponsorId/statement')
  @RequirePermissions(PERMISSIONS.school.readFees)
  sponsorStatement(@Param('sponsorId') sponsorId: string) {
    this.assertSponsorshipEnabled();
    return this.finance.sponsorStatement(sponsorId);
  }

  /**
   * Whether sponsorship is enabled, so the UI can render an honest
   * "not production-ready" panel instead of a form that appears to work.
   * Unguarded by design — it is the question, not the feature.
   */
  @Get('sponsorships/availability')
  @RequirePermissions(PERMISSIONS.school.readFees)
  sponsorshipAvailability() {
    return {
      enabled: process.env.SCHOOL_SPONSORSHIP_ENABLED === 'true',
      reason:
        'No sponsor-payment path exists: collections land on the student AR, so a sponsor cap ' +
        'cannot be enforced and sponsor-paid amounts cannot be attributed.',
    };
  }

  /* Waivers */
  @Post('waivers')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createWaiver(@Body() dto: any) {
    return this.finance.createWaiver(dto);
  }

  @Get('waivers')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listWaivers(@Query('studentProfileId') studentProfileId?: string) {
    return this.finance.listWaivers(studentProfileId);
  }

  // Phase 0: applying a waiver forgives real receivable. It no longer shares a
  // permission with "edit a fee structure" — see PERMISSIONS.school.approveWaivers.
  @Post('waivers/:id/approve')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveWaivers)
  approveWaiver(@Param('id') id: string) {
    return this.finance.approveWaiver(id);
  }

  @Post('waivers/:id/reject')
  @RequirePermissions(PERMISSIONS.school.approveWaivers)
  rejectWaiver(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.finance.rejectWaiver(id, body?.reason);
  }

  @Post('waivers/:id/apply')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveWaivers)
  applyWaiver(@Param('id') id: string) {
    return this.finance.applyWaiver(id);
  }

  /* Fee credits */
  // Phase 0: creating a credit mints a balance-sheet liability (Dr AR / Cr
  // Fee-Credit Liability) with no funding source required — P1-2. Gated behind
  // its own permission until A2 makes an explicit origin mandatory.
  @Post('credits')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.approveCredits)
  createCredit(@Body() dto: any) {
    return this.finance.createCredit(dto);
  }

  @Get('credits')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listCredits(@Query('studentProfileId') studentProfileId?: string) {
    return this.finance.listCredits(studentProfileId);
  }

  @Post('credits/:studentProfileId/apply')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  applyCredits(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.applyCredits(studentProfileId);
  }

  /* Waiver categories (catalog) */
  @Post('waiver-categories')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  createWaiverCategory(@Body() dto: any) {
    return this.finance.createWaiverCategory(dto);
  }

  @Get('waiver-categories')
  @RequirePermissions(PERMISSIONS.school.readFees)
  listWaiverCategories(@Query('includeInactive') includeInactive?: string) {
    return this.finance.listWaiverCategories(includeInactive === 'true');
  }

  @Patch('waiver-categories/:id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  updateWaiverCategory(@Param('id') id: string, @Body() dto: any) {
    return this.finance.updateWaiverCategory(id, dto);
  }

  @Delete('waiver-categories/:id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  deleteWaiverCategory(@Param('id') id: string) {
    return this.finance.deleteWaiverCategory(id);
  }

  /* ── C2 · SMS reminders ── */

  /**
   * Remind guardians who still owe. `overdue` switches from "due in N days" to
   * "already past due"; `classId` narrows it to one class, which is how a head
   * teacher actually uses it.
   *
   * Not idempotent-guarded at the route: the subscriber's per-pupil dedupeKey
   * already collapses a repeat run on the same day into one message.
   */
  @Post('reminders/send')
  @RequirePermissions(PERMISSIONS.school.collectPayments)
  sendReminders(
    @Body() body: { classId?: string; daysAhead?: number; overdue?: boolean; minBalance?: number },
  ) {
    return this.feeNotifications.remind({
      organizationId: this.tenant.organizationId,
      classId: body?.classId ?? null,
      daysAhead: body?.daysAhead,
      overdue: body?.overdue,
      minBalance: body?.minBalance,
    });
  }

  /* Fee defaulters & bad debtors (read-only reports) */
  @Get('fee-defaulters')
  @RequirePermissions(PERMISSIONS.school.readFees)
  feeDefaulters(
    @Query('asOf') asOf?: string,
    @Query('minBalance') minBalance?: string,
    @Query('classId') classId?: string,
  ) {
    return this.finance.feeDefaulters(asOf, minBalance ? Number(minBalance) : 0, classId);
  }

  @Get('bad-debtors')
  @RequirePermissions(PERMISSIONS.school.readFees)
  badDebtors(
    @Query('asOf') asOf?: string,
    @Query('thresholdDays') thresholdDays?: string,
    @Query('classId') classId?: string,
  ) {
    return this.finance.badDebtors(asOf, thresholdDays ? Number(thresholdDays) : 90, classId);
  }

  // Phase 0: a write-off permanently forgives the whole outstanding balance.
  @Post('bad-debtors/:studentProfileId/write-off')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.writeOffFees)
  writeOffBadDebt(@Param('studentProfileId') studentProfileId: string, @Body() dto: any) {
    return this.finance.writeOffBadDebt(studentProfileId, dto ?? {});
  }

  /* Aging (P2) */
  @Get('aging')
  @RequirePermissions(PERMISSIONS.school.readFees)
  aging(@Query('asOf') asOf?: string) {
    return this.finance.aging(asOf);
  }
}
