import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PortalsService } from './portals.service';
import { MobileMoneyService } from '../fees/mobile-money.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { PortalIdentityService } from '../../../kernel/auth/portal-identity.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';

@Controller('school/portals')
export class PortalsController {
  constructor(
    private readonly portals: PortalsService,
    // Parent self-service payment: the portal already shows a balance — this
    // lets it take the money. Both delegate; the portal owns no money logic.
    private readonly momo: MobileMoneyService,
    private readonly finance: SchoolFinanceQueryService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly employeeIdentity: EmployeeIdentityService,
  ) {}

  /**
   * Ownership check for every per-student portal route.
   *
   * `school.parentPortal` / `school.studentPortal` are COARSE permissions: they say
   * "this account may use the portal", not "this account may see THIS pupil". Until
   * portal identity existed there was no way to express the second, so these routes
   * took the id from the URL and served whoever asked — the docstring on the
   * pay-quote route asserted an ownership rule the code never implemented. Staff
   * pass through and remain governed by their own school permissions.
   */
  private async assertMaySee(studentProfileId: string): Promise<void> {
    if (!(await this.portalIdentity.canAccessStudent(studentProfileId))) {
      throw new ForbiddenException('Not permitted to view this student');
    }
  }

  /**
   * Ownership check for per-TEACHER routes.
   *
   * `school.teacherPortal` / `school.read` are coarse: they say "this account
   * may use the teacher workspace", not "this account IS that teacher". These
   * routes took the id straight from the URL, so any authenticated holder of
   * the coarse permission could read another teacher's classes, lesson plans
   * and workload by editing the id. Admins with the explicit management
   * permission are still allowed through.
   */
  private assertIsTeacherOrAdmin(teacherPartnerId: string, adminPermission: string): Promise<void> {
    return this.employeeIdentity.assertIsTeacherOrAdmin(teacherPartnerId, adminPermission);
  }

  /** Same check for a list of ids; every one must be permitted. */
  private async assertMaySeeAll(ids: string[]): Promise<void> {
    const allowed = await this.portalIdentity.filterAccessibleStudents(ids);
    if (allowed.length !== ids.length) {
      throw new ForbiddenException('Not permitted to view one or more of these students');
    }
  }

  @Get('parent/:studentProfileIds')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  async parentDashboard(@Param('studentProfileIds') ids: string) {
    const list = ids.split(',').filter(Boolean);
    await this.assertMaySeeAll(list);
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
    await this.assertMaySee(studentProfileId);
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
  async pay(
    @Param('studentProfileId') studentProfileId: string,
    @Body() dto: { provider: 'mtn' | 'airtel'; amount: number; phone: string },
  ) {
    await this.assertMaySee(studentProfileId);
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
  async payments(@Param('studentProfileId') studentProfileId: string) {
    await this.assertMaySee(studentProfileId);
    return this.momo.listRequests({ studentProfileId, limit: 20 });
  }

  /** "Why do I owe this?" — the same explainer the bursar sees. */
  @Get('parent/:studentProfileId/explain')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  async explain(@Param('studentProfileId') studentProfileId: string) {
    await this.assertMaySee(studentProfileId);
    return this.finance.explainBalance(studentProfileId);
  }

  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  async studentDashboard(@Param('studentProfileId') id: string) {
    await this.assertMaySee(id);
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