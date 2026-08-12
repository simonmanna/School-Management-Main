import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PasswordService } from './password.service';
import { EventBus } from '../events/event-bus';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { OneTimeTokenPurpose } from '@prisma/client';

/**
 * F.5 — One-time-use tokens for password reset, email verification, invites.
 * Tokens are returned to the caller once; only their SHA-256 hash is persisted.
 * Default TTL: 30 minutes for reset/verify, 7 days for invite.
 */
@Injectable()
export class OneTimeTokenService {
  private readonly logger = new Logger('OneTimeTokenService');
  private static readonly TTL_MS: Record<OneTimeTokenPurpose, number> = {
    password_reset: 30 * 60 * 1000,
    email_verification: 24 * 60 * 60 * 1000,
    invite: 7 * 24 * 60 * 60 * 1000,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly password: PasswordService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Issue a token. Returns the raw token (the only time it is visible). */
  async issue(params: {
    purpose: OneTimeTokenPurpose;
    userId: string;
    organizationId: string;
    payload?: Record<string, unknown>;
    ttlMs?: number;
  }): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(raw).digest('hex');
    const ttl = params.ttlMs ?? OneTimeTokenService.TTL_MS[params.purpose];
    await this.prisma.raw.oneTimeToken.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        tokenHash: hash,
        purpose: params.purpose,
        expiresAt: new Date(Date.now() + ttl),
        payload: (params.payload ?? {}) as any,
      },
    });
    return raw;
  }

  /** Consume a token. Returns the user/org if valid; null otherwise. */
  async consume(raw: string, purpose: OneTimeTokenPurpose): Promise<{ userId: string; organizationId: string } | null> {
    const hash = createHash('sha256').update(raw).digest('hex');
    const row = await this.prisma.raw.oneTimeToken.findUnique({ where: { tokenHash: hash } });
    if (!row) return null;
    if (row.purpose !== purpose) return null;
    if (row.consumedAt) return null;
    if (row.expiresAt < new Date()) return null;
    if (!row.organizationId) return null;
    await this.prisma.raw.oneTimeToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return { userId: row.userId!, organizationId: row.organizationId };
  }

  /** Request a password reset — always returns ok to prevent email enumeration. */
  async requestReset(email: string, organizationCode: string, request?: { ip?: string; userAgent?: string }) {
    const org = await this.prisma.raw.organization.findUnique({ where: { code: organizationCode } });
    if (!org || org.status !== 'active') {
      // Return ok to avoid leaking which orgs exist.
      return { ok: true };
    }
    const user = await this.prisma.raw.user.findFirst({
      where: { organizationId: org.id, email, isActive: true },
    });
    if (user) {
      const token = await this.issue({
        purpose: 'password_reset',
        userId: user.id,
        organizationId: org.id,
        payload: { ip: request?.ip },
      });
      await this.notifications.send({
        organizationId: org.id,
        userId: user.id,
        channel: 'email',
        category: 'auth',
        title: 'Reset your password',
        body: `Click the link to reset your password. The link expires in 30 minutes.`,
        payload: { token, kind: 'password_reset' },
      });
      await this.audit.record({
        entity: 'User',
        entityId: user.id,
        action: 'update',
        newValues: { passwordResetRequested: true },
        ipAddress: request?.ip,
        userAgent: request?.userAgent ?? undefined,
      });
    }
    return { ok: true };
  }

  /** Apply a reset token + new password. Returns ok on success. */
  async applyReset(raw: string, newPassword: string) {
    const consumed = await this.consume(raw, 'password_reset');
    if (!consumed) throw new Error('Invalid or expired reset token');
    const hash = await this.password.hash(newPassword);
    await this.prisma.raw.user.update({
      where: { id: consumed.userId! },
      data: { passwordHash: hash, failedLoginCount: 0, lockedUntil: null },
    });
    // Revoke all refresh tokens for this user (force re-login on all devices).
    await this.prisma.raw.refreshToken.updateMany({
      where: { userId: consumed.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      entity: 'User',
      entityId: consumed.userId,
      action: 'update',
      newValues: { passwordResetCompleted: true },
    });
    this.events.publish('user.password_reset' as any, {
      userId: consumed.userId,
      organizationId: consumed.organizationId,
      at: new Date().toISOString(),
    });
    return { ok: true };
  }
}
