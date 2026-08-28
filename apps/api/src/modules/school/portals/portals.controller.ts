import { Body, Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ScopedToStudent } from '../../../kernel/auth/guards/scoped-to-student.decorator';
import { PortalsService } from './portals.service';
import { PortalDocumentsService } from './portal-documents.service';
import { MobileMoneyService } from '../fees/mobile-money.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';

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

  @Get('parent/:studentProfileIds')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  @ScopedToStudent('studentProfileIds')
  parentDashboard(@Param('studentProfileIds') ids: string) {
    return this.portals.parentDashboard(ids.split(',').filter(Boolean));
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