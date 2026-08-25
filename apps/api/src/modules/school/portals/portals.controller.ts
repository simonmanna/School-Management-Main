import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PortalsService } from './portals.service';
import { MobileMoneyService } from '../fees/mobile-money.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';

@Controller('school/portals')
export class PortalsController {
  constructor(
    private readonly portals: PortalsService,
    // Parent self-service payment: the portal already shows a balance — this
    // lets it take the money. Both delegate; the portal owns no money logic.
    private readonly momo: MobileMoneyService,
    private readonly finance: SchoolFinanceQueryService,
  ) {}

  @Get('parent/:studentProfileIds')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  parentDashboard(@Param('studentProfileIds') ids: string) {
    const list = ids.split(',').filter(Boolean);
    return this.portals.parentDashboard(list);
  }

  /* ── Parent self-service payment ── */

  /**
   * What this pupil owes, and whether the school can take a phone payment.
   * Gated on the PARENT portal permission, so a guardian sees only their own
   * children — the same gate the dashboard above uses.
   */
  @Get('parent/:studentProfileId/pay-quote')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  async payQuote(@Param('studentProfileId') studentProfileId: string) {
    const [quote, availability] = await Promise.all([
      this.momo.quoteFor(studentProfileId),
      Promise.resolve(this.momo.availability()),
    ]);
    return { ...quote, providers: availability };
  }

  /**
   * Pay from the portal. The parent's phone is prompted; nothing is recorded as
   * money until the provider confirms on the callback, which posts it through
   * the same writer a bursar's cash receipt uses.
   */
  @Post('parent/:studentProfileId/pay')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  pay(
    @Param('studentProfileId') studentProfileId: string,
    @Body() dto: { provider: 'mtn' | 'airtel'; amount: number; phone: string },
  ) {
    return this.momo.requestPayment(dto?.provider, {
      studentProfileId,
      amount: dto?.amount,
      phone: dto?.phone,
      note: 'School fees (parent portal)',
    });
  }

  /** Progress of the parent's own payment attempts. */
  @Get('parent/:studentProfileId/payments')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  payments(@Param('studentProfileId') studentProfileId: string) {
    return this.momo.listRequests({ studentProfileId, limit: 20 });
  }

  /** "Why do I owe this?" — the same explainer the bursar sees. */
  @Get('parent/:studentProfileId/explain')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  explain(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.explainBalance(studentProfileId);
  }

  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  studentDashboard(@Param('studentProfileId') id: string) {
    return this.portals.studentDashboard(id);
  }

  @Get('teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.teacherPortal)
  teacherDashboard(@Param('teacherPartnerId') id: string) {
    return this.portals.teacherDashboard(id);
  }

  /** The teacher workspace (P5) — aggregated "what needs doing" for one teacher. */
  @Get('teaching/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  teachingOverview(@Param('teacherPartnerId') id: string) {
    return this.portals.teacherOverview(id);
  }
}