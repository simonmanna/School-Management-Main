import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Applicant/parent portal (Phase 3). Applicants prove control of the email/phone
 * on their application and receive a short-lived magic-link token that scopes
 * them to exactly one application — view status, upload documents, accept/decline
 * their offer — without a full platform account.
 *
 * The raw token is emailed and never stored; only its SHA-256 is persisted, so a
 * DB leak does not hand over live portal sessions.
 */
@Injectable()
export class AdmissionsPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Issue a portal magic link for an application, addressed to a contact point
   * that MUST already be on the application or one of its guardians — otherwise
   * anyone could request a link to somebody else's application by guessing the id.
   */
  async issueAccessLink(applicationId: string, email: string) {
    const organizationId = this.tenant.organizationId;
    const app = await this.prisma.client.admissionApplication.findFirst({
      where: { id: applicationId },
      include: { guardians: true },
    });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    const known = new Set<string>();
    for (const g of app.guardians) if (g.email) known.add(g.email.trim().toLowerCase());
    if (!known.has(email.trim().toLowerCase())) {
      throw new BadRequestException('That email is not on file for this application');
    }

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.client.admissionPortalToken.create({
      data: {
        organizationId,
        applicationId,
        tokenHash: this.hash(raw),
        email,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const link = `${process.env.PORTAL_BASE_URL ?? ''}/apply/track?token=${raw}`;
    await this.notifications.send({
      organizationId,
      channel: 'email',
      category: 'admissions',
      title: 'Your application access link',
      body: `Track application ${app.applicationNumber}: ${link}`,
      payload: { href: link },
    });
    // The raw token is returned only so a dev/test caller can follow the link;
    // in production the applicant receives it by email above.
    return { issued: true, expiresAt: new Date(Date.now() + TOKEN_TTL_MS), devToken: process.env.NODE_ENV === 'production' ? undefined : raw };
  }

  /**
   * Resolve a raw portal token to its application id, or throw. Used by the
   * portal controller (a @Public route) — the token is the authorization, so this
   * runs on the unscoped raw client and returns only the org + application id the
   * caller then operates within.
   */
  async resolveToken(raw: string): Promise<{ organizationId: string; applicationId: string; tokenId: string }> {
    const row = await this.prisma.raw.admissionPortalToken.findFirst({ where: { tokenHash: this.hash(raw) } });
    if (!row) throw new NotFoundException('Invalid access link');
    if (row.expiresAt.getTime() < Date.now()) throw new BadRequestException('This access link has expired');
    return { organizationId: row.organizationId, applicationId: row.applicationId, tokenId: row.id };
  }

  /**
   * The applicant-facing view of one application: status, documents (metadata
   * only), offer, and the missing-requirements checklist. Never returns the NIN
   * or another applicant's data.
   */
  async portalView(applicationId: string) {
    const app = await this.prisma.raw.admissionApplication.findFirst({
      where: { id: applicationId },
      include: {
        documents: { select: { id: true, type: true, required: true, verified: true, rejectionReason: true, uploadedAt: true } },
        offerLetter: true,
        academicYear: { select: { name: true } },
        applyingForClass: { select: { name: true } },
      },
    });
    if (!app) throw new NotFoundException('Application not found');
    return {
      applicationNumber: app.applicationNumber,
      applicantName: `${app.applicantFirstName} ${app.applicantLastName}`,
      status: app.status,
      academicYear: app.academicYear?.name ?? null,
      applyingForClass: app.applyingForClass?.name ?? null,
      feeStatus: app.feeStatus,
      documents: app.documents,
      offer: app.offerLetter
        ? { status: app.offerLetter.status, expiresAt: app.offerLetter.expiresAt, body: app.offerLetter.body }
        : null,
    };
  }
}
