import { Body, Controller, Get, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ScopedToStudent } from '../../../kernel/auth/guards/scoped-to-student.decorator';
import { PortalsService } from './portals.service';
import { PortalDocumentsService } from './portal-documents.service';
import { PortalTransportService } from './portal-transport.service';
import { MobileMoneyService } from '../fees/mobile-money.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import { CareLogService } from '../early-years/care-log.service';
import { PickupService } from '../early-years/pickup.service';
import { PortalPickupRequestDto } from '../early-years/dto.types';

@Controller('school/portals')
export class PortalsController {
  constructor(
    private readonly portals: PortalsService,
    // Parent self-service payment: the portal already shows a balance — this
    // lets it take the money. Both delegate; the portal owns no money logic.
    private readonly momo: MobileMoneyService,
    private readonly finance: SchoolFinanceQueryService,
    private readonly documents: PortalDocumentsService,
    private readonly employeeIdentity: EmployeeIdentityService,
    private readonly careLogs: CareLogService,
    private readonly pickup: PickupService,
    private readonly transport: PortalTransportService,
  ) {}

  /**
   * Ownership check for per-TEACHER routes.
   *
   * `school.teacherPortal` / `school.read` are coarse: they say "this account
   * may use the teacher workspace", not "this account IS that teacher". These
   * routes took the id straight from the URL, so any authenticated holder of
   * the coarse permission could read another teacher's classes, lesson plans
   * and workload by editing the id. Admins with the explicit management
   * permission are still allowed through.
   *
   * The per-STUDENT equivalent used to live here too, as a private method. It is
   * now `@ScopedToStudent`, so the rule applies wherever it is declared instead
   * of only where someone remembered to call it.
   */
  private assertIsTeacherOrAdmin(teacherPartnerId: string, adminPermission: string): Promise<void> {
    return this.employeeIdentity.assertIsTeacherOrAdmin(teacherPartnerId, adminPermission);
  }

  /**
   * Who am I, and whose data may I open?
   *
   * Gated on `school:portal:self` — a grant that authorizes nothing except asking
   * this question. Every portal role holds it, which matters because the app must
   * resolve who it is talking to before it can decide which workspace to open,
   * and `PermissionsGuard` ANDs its requirements, so the three workspace grants
   * below cannot be OR-ed together here.
   *
   * It is deliberately NOT `school:read`. Around 300 routes across the school
   * vertical are gated on that grant alone — the full pupil register, every
   * family's fee balance, the gradebook, the marks workspace — so using it to
   * make this one route work would have opened all of them to any portal token.
   *
   * The answer is derived from the token, so a caller with no portal identity
   * gets an empty result rather than somebody else's.
   */
  @Get('me')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  me() {
    return this.portals.myContext();
  }

  /**
   * Phase 6: the caller's own notice history.
   *
   * Same grant as `me` and for the same reason — the subject is the token, not
   * a parameter, so there is nothing here for a caller to edit into somebody
   * else's inbox.
   */
  @Get('notifications')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  myNotifications(@Query('limit') limit?: string) {
    return this.portals.myNotifications(limit ? Number(limit) : 50);
  }

  @Post('notifications/:id/read')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  markNotificationRead(@Param('id') id: string) {
    return this.portals.markNotificationRead(id);
  }

  @Get('parent/:studentProfileIds')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileIds')
  parentDashboard(@Param('studentProfileIds') ids: string) {
    return this.portals.parentDashboard(ids.split(',').filter(Boolean));
  }

  /**
   * The nursery day, for the family.
   *
   * Only logs the room has shared: a half-finished note about a child being
   * unsettled is not something a parent should read at lunchtime, so the draft
   * stays inside the school until the class teacher releases it (see
   * `CareLogService.setShared`). `@ScopedToStudent` means a parent can only ask
   * about their own child, whatever id they put in the URL.
   */
  @Get('parent/:studentProfileId/care-log')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  parentCareLog(
    @Param('studentProfileId') studentProfileId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.careLogs.sharedForStudent(studentProfileId, { from, to });
  }

  /* ── Parent self-service payment ── */

  /**
   * What this pupil owes, and whether the school can take a phone payment.
   * Gated on the PARENT portal permission, so a guardian sees only their own
   * children — the same gate the dashboard above uses.
   */
  @Get('parent/:studentProfileId/pay-quote')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
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
  // Money leaves a phone here. A parent pays once; a loop is either a bug in the
  // client or somebody probing the mobile-money bridge.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('parent/:studentProfileId/pay')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
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
  @ScopedToStudent('studentProfileId')
  payments(@Param('studentProfileId') studentProfileId: string) {
    return this.momo.listRequests({ studentProfileId, limit: 20 });
  }

  /** "Why do I owe this?" — the same explainer the bursar sees. */
  @Get('parent/:studentProfileId/explain')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  explain(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.explainBalance(studentProfileId);
  }

  /**
   * What is owed, split by whether it is due yet.
   *
   * A single "outstanding" figure makes a family paying by instalments look
   * exactly like a family that has not paid at all. The split is computed in the
   * finance service beside the balance it must agree with — never here, and never
   * in the browser.
   */
  @Get('parent/:studentProfileId/outstanding')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  outstanding(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.outstandingBreakdown(studentProfileId);
  }

  /**
   * The family's own fee statement — the same `termStatement` the bursar prints,
   * so the two cannot disagree.
   */
  @Get('parent/:studentProfileId/statement')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  statement(@Param('studentProfileId') studentProfileId: string) {
    return this.finance.termStatement(studentProfileId);
  }

  /* ── Documents a family may download ── */

  /** Report cards released to this pupil's family. Published ones only. */
  @Get('student/:studentProfileId/report-cards')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  @ScopedToStudent('studentProfileId')
  reportCards(@Param('studentProfileId') studentProfileId: string) {
    return this.documents.publishedReportCards(studentProfileId);
  }

  /**
   * One report card as a PDF.
   *
   * The pupil is NOT in this URL — a report-card id is — so `@ScopedToStudent`
   * cannot help. Ownership is resolved from the card itself inside the service,
   * which also refuses anything the school has not published.
   */
  @Get('report-cards/:reportCardId/pdf')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  // Phase 7. The global tier is 100 requests a minute, which is generous for a
  // route that renders a PDF per call and returns a named child's marks: a
  // family downloads two or three a term, and anything walking the id space is
  // not a family. Ownership is already enforced in the service; this bounds the
  // cost and the enumeration rate of getting it wrong.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reportCardPdf(
    @Param('reportCardId') reportCardId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.documents.reportCardPdf(reportCardId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  /** Wave 16: my child's route, stops and today's trips. */
  @Get('parent/:studentProfileId/transport')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  transportView(@Param('studentProfileId') studentProfileId: string) {
    return this.transport.forFamily(studentProfileId);
  }

  /* ── Wave 16: who may collect my child ── */

  @Get('parent/:studentProfileId/pickup')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  pickupList(@Param('studentProfileId') studentProfileId: string) {
    return this.pickup.listForFamily(studentProfileId);
  }

  /** Ask for another adult to be allowed to collect. Pending until the office approves. */
  @Post('parent/:studentProfileId/pickup')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  pickupRequest(@Param('studentProfileId') studentProfileId: string, @Body() dto: PortalPickupRequestDto) {
    return this.pickup.requestFromPortal({ ...dto, studentProfileId });
  }

  /** Withdraw a collector at once — this can only make the gate stricter. */
  @Patch('parent/:studentProfileId/pickup/:id/withdraw')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  pickupWithdraw(@Param('studentProfileId') studentProfileId: string, @Param('id') id: string) {
    return this.pickup.withdrawFromPortal(studentProfileId, id);
  }

  /** Wave 16: the family's fee receipts. */
  @Get('parent/:studentProfileId/receipts')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileId')
  feeReceipts(@Param('studentProfileId') studentProfileId: string) {
    return this.documents.feeReceipts(studentProfileId);
  }

  /** One receipt as a PDF (family copy). Ownership is resolved from the payment. */
  @Get('receipts/:paymentId/pdf')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async feeReceiptPdf(@Param('paymentId') paymentId: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.documents.feeReceiptPdf(paymentId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  @ScopedToStudent('studentProfileId')
  studentDashboard(@Param('studentProfileId') id: string) {
    return this.portals.studentDashboard(id);
  }

  @Get('teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.teacherPortal)
  async teacherDashboard(@Param('teacherPartnerId') id: string) {
    await this.assertIsTeacherOrAdmin(id, PERMISSIONS.school.manageStaff);
    return this.portals.teacherDashboard(id);
  }

  /** The teacher workspace (P5) — aggregated "what needs doing" for one teacher. */
  @Get('teaching/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  async teachingOverview(@Param('teacherPartnerId') id: string) {
    await this.assertIsTeacherOrAdmin(id, PERMISSIONS.school.manageStaff);
    return this.portals.teacherOverview(id);
  }
}