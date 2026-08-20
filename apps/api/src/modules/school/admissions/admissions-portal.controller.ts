import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Public } from '../../../kernel/auth/decorators/public.decorator';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AdmissionsPortalService } from './admissions-portal.service';
import { AdmissionsService } from './admissions.service';

/**
 * Applicant/parent portal (Phase 3). The staff-facing issue-link route is
 * authenticated; the applicant-facing routes are @Public and authorized solely
 * by the magic-link token, which scopes the caller to exactly one application.
 */
@Controller('school/admissions/portal')
export class AdmissionsPortalController {
  constructor(
    private readonly portal: AdmissionsPortalService,
    private readonly admissions: AdmissionsService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Staff issues a magic link to a guardian email that is on file. */
  @Post(':id/link')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  issueLink(@Param('id') id: string, @Body('email') email: string) {
    return this.portal.issueAccessLink(id, email);
  }

  /** Applicant reads their own application by token (no account needed). */
  @Public()
  @Get('application')
  async view(@Query('token') token: string) {
    const { applicationId } = await this.portal.resolveToken(token);
    return this.portal.portalView(applicationId);
  }

  /** Applicant accepts their offer through the portal, within the app's tenant. */
  @Public()
  @Post('offer/accept')
  async accept(@Query('token') token: string) {
    const { organizationId, applicationId } = await this.portal.resolveToken(token);
    return this.tenant.run(
      { organizationId, userId: 'portal:applicant', permissions: [] },
      () => this.admissions.acceptOffer(applicationId),
    );
  }

  /** Applicant declines their offer through the portal. */
  @Public()
  @Post('offer/decline')
  async decline(@Query('token') token: string) {
    const { organizationId, applicationId } = await this.portal.resolveToken(token);
    return this.tenant.run(
      { organizationId, userId: 'portal:applicant', permissions: [] },
      () => this.admissions.declineOffer(applicationId),
    );
  }
}
