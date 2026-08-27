import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { OneTimeTokenService } from '../../../kernel/auth/one-time-token.service';
import { PasswordService } from '../../../kernel/auth/password.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { randomBytes } from 'node:crypto';

export interface InvitePortalAccountDto {
  subjectType: 'student' | 'guardian';
  /** Required iff subjectType === 'student'. */
  studentProfileId?: string;
  /** Required iff subjectType === 'guardian'. FK to Contact. */
  guardianContactId?: string;
  /** Where the invite is sent. Becomes the login identifier. */
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Provisioning for portal (student / guardian) logins.
 *
 * A portal account is an ordinary `User` row plus one or more `PortalIdentity`
 * rows saying which real person it speaks for. It is created INACTIVE with an
 * unusable password: the account only becomes usable when the invitee accepts
 * their one-time invite and sets a password of their own. That way a registrar
 * never handles, chooses or sees an end user's password.
 */
@Injectable()
export class PortalAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly tokens: OneTimeTokenService,
    private readonly password: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * Invite one person. Idempotent on (email, subject): re-inviting an existing,
   * not-yet-accepted account re-issues the token rather than erroring, because
   * "the email never arrived" is the common case in a school office.
   */
  async invite(dto: InvitePortalAccountDto): Promise<{ userId: string; inviteToken: string; expiresInDays: number }> {
    const email = (dto.email ?? '').trim().toLowerCase();
    if (!email) throw new BadRequestException('An email address is required to invite a portal account');
    this.assertSubjectShape(dto);
    const subject = await this.loadSubject(dto);

    const existing = await this.prisma.client.user.findFirst({ where: { email } });

    // An ACTIVE account with a password already belongs to someone — most often
    // a member of staff. Silently attaching a pupil's identity to it would grant
    // that person the family's data, so this is a hard stop.
    if (existing && existing.isActive) {
      const already = await this.identityRows(existing.id, dto);
      if (already) return { userId: existing.id, inviteToken: '', expiresInDays: 0 };
      throw new ConflictException(
        `${email} already has an active account. Link the subject from that account instead of inviting.`,
      );
    }

    const user =
      existing ??
      (await this.prisma.client.user.create({
        data: {
          organizationId: this.org,
          email,
          // Unusable until acceptance: random bytes, hashed, never sent anywhere.
          // A null column is not an option (the field is required), and a known
          // placeholder would be a shared secret across every pending account.
          passwordHash: await this.password.hash(randomBytes(32).toString('base64url')),
          firstName: dto.firstName ?? subject.firstName ?? 'Portal',
          lastName: dto.lastName ?? subject.lastName ?? 'User',
          isActive: false,
        },
      }));

    await this.linkIdentity(user.id, dto);

    const inviteToken = await this.tokens.issue({
      purpose: 'invite',
      userId: user.id,
      organizationId: this.org,
      payload: { portal: true, subjectType: dto.subjectType },
    });

    await this.notifications
      .send({
        organizationId: this.org,
        userId: user.id,
        channel: 'email',
        category: 'portal_invite',
        title: 'Your school portal account',
        body:
          `Hello ${dto.firstName ?? subject.firstName ?? ''},\n\n` +
          `An account has been created for you on the school portal. ` +
          `Use the code below to choose a password. It expires in 7 days.\n\n` +
          `Invite code: ${inviteToken}\n`,
        payload: { inviteToken },
      })
      .catch(() => undefined); // delivery failure must not roll back provisioning

    await this.audit.record({
      entity: 'PortalIdentity',
      entityId: user.id,
      action: 'create',
      newValues: { email, subjectType: dto.subjectType },
    });

    return { userId: user.id, inviteToken, expiresInDays: 7 };
  }

  /** Revoke portal access without deleting the audit trail. */
  async revoke(portalIdentityId: string): Promise<{ ok: true }> {
    const row = await this.prisma.client.portalIdentity.findFirst({
      where: { id: portalIdentityId, organizationId: this.org },
    });
    if (!row) throw new NotFoundException('Portal identity not found');
    await this.prisma.client.portalIdentity.update({
      where: { id: portalIdentityId },
      data: { revokedAt: new Date() },
    });
    // Access tokens live 15 minutes; killing the refresh tokens stops renewal so
    // revocation is complete within that window rather than at next login.
    await this.prisma.client.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ entity: 'PortalIdentity', entityId: portalIdentityId, action: 'update', newValues: { revoked: true } });
    return { ok: true };
  }

  /** Portal accounts attached to one student, for the registrar's screen. */
  async listForStudent(studentProfileId: string) {
    return this.prisma.client.portalIdentity.findMany({
      where: { organizationId: this.org, studentProfileId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── internals ──

  private assertSubjectShape(dto: InvitePortalAccountDto): void {
    if (dto.subjectType === 'student' && !dto.studentProfileId) {
      throw new BadRequestException('studentProfileId is required for a student portal account');
    }
    if (dto.subjectType === 'guardian' && !dto.guardianContactId) {
      throw new BadRequestException('guardianContactId is required for a guardian portal account');
    }
    if (dto.studentProfileId && dto.guardianContactId) {
      throw new BadRequestException('A portal identity speaks for exactly one subject');
    }
  }

  /** Confirm the subject exists in this tenant, and borrow a name for the account. */
  private async loadSubject(dto: InvitePortalAccountDto): Promise<{ firstName?: string; lastName?: string }> {
    if (dto.subjectType === 'student') {
      const sp = await this.prisma.client.studentProfile.findFirst({
        where: { id: dto.studentProfileId, organizationId: this.org, deletedAt: null },
        include: { partner: { select: { name: true } } },
      });
      if (!sp) throw new NotFoundException('Student not found');
      const [first, ...rest] = (sp.partner?.name ?? '').split(' ');
      return { firstName: first || undefined, lastName: rest.join(' ') || undefined };
    }
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: dto.guardianContactId, organizationId: this.org, deletedAt: null },
      select: { firstName: true, lastName: true },
    });
    if (!contact) throw new NotFoundException('Guardian contact not found');
    return { firstName: contact.firstName ?? undefined, lastName: contact.lastName ?? undefined };
  }

  private async identityRows(userId: string, dto: InvitePortalAccountDto) {
    return this.prisma.client.portalIdentity.findFirst({
      where: {
        userId,
        organizationId: this.org,
        subjectType: dto.subjectType,
        studentProfileId: dto.studentProfileId ?? null,
        guardianContactId: dto.guardianContactId ?? null,
        revokedAt: null,
      },
    });
  }

  private async linkIdentity(userId: string, dto: InvitePortalAccountDto): Promise<void> {
    if (await this.identityRows(userId, dto)) return; // already linked
    await this.prisma.client.portalIdentity.create({
      data: {
        organizationId: this.org,
        userId,
        subjectType: dto.subjectType,
        studentProfileId: dto.studentProfileId ?? null,
        guardianContactId: dto.guardianContactId ?? null,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }
}
