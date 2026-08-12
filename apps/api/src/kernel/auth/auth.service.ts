import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { EncryptionService } from '../encryption/encryption.service';
import { JwtTokenService, type AuthUser } from './jwt-token.service';
import { PasswordService } from './password.service';
import { MfaService } from './mfa.service';
import { hashRefreshToken, newRefreshTokenValue } from './refresh-token.util';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { MfaLoginDto } from './dto/mfa-login.dto';

interface UserWithRoles {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string | null;
  passwordHash: string;
  isActive: boolean;
  mfaSecret: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  roles: { name: string; permissions: string[] }[];
}

/** Read the decrypted MFA secret, handling the case where encryption columns
 * exist but are null (legacy row created before F.5). */
function readMfaSecret(user: { mfaSecret: string | null }, enc: EncryptionService): string | null {
  if (!user.mfaSecret) return null;
  try {
    return enc.decrypt({
      ciphertext: user.mfaSecret,
      // We packed iv/tag into the same column for backwards compatibility;
      // new code uses the dedicated columns. For legacy rows, treat the
      // stored value as plaintext (login attempt log will surface this).
      iv: '',
      tag: '',
    });
  } catch {
    return user.mfaSecret;
  }
}

/** Phase B1: lockout policy. */
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly jwt: JwtTokenService,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly mfa: MfaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Step 1 of login: verify password. If the user has MFA enrolled, return
   * a short-lived `mfaToken` that the client must exchange (with the TOTP
   * code) via `mfaLogin`. If MFA is not enrolled, return access + refresh.
   */
  async login(dto: LoginDto, request?: Request): Promise<LoginResult> {
    const ipAddress = request?.ip;
    const userAgent = (request?.headers?.['user-agent'] as string | undefined) ?? null;
    const org = await this.prisma.client.organization.findUnique({
      where: { code: dto.organizationCode },
    });
    if (!org || org.status !== 'active') {
      await this.recordAttempt(null, dto.email, false, false, ipAddress, userAgent, 'org_inactive_or_missing');
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.tenant.run({ organizationId: org.id }, async () => {
      const user = (await this.prisma.client.user.findFirst({
        where: { email: dto.email, isActive: true },
        include: { roles: true },
      })) as UserWithRoles | null;

      // Lockout check (do this even when user is missing to slow enumeration).
      if (user && user.lockedUntil && user.lockedUntil > new Date()) {
        await this.recordAttempt(org.id, dto.email, false, false, ipAddress, userAgent, 'account_locked');
        throw new UnauthorizedException('Account temporarily locked; try again later');
      }

      const passwordOk = user && (await this.password.compare(dto.password, user.passwordHash));
      if (!user || !passwordOk) {
        await this.recordAttempt(org.id, dto.email, false, false, ipAddress, userAgent, 'bad_credentials');
        await this.recordFailedLogin(user);
        throw new UnauthorizedException('Invalid credentials');
      }

      // Successful password. If MFA enrolled, do NOT issue tokens yet.
      if (user.mfaSecret) {
        const mfaSecret = readMfaSecret(user, this.encryption);
        if (!mfaSecret) {
          throw new UnauthorizedException('MFA misconfigured; contact your administrator');
        }
        const mfaToken = randomBytes(24).toString('base64url');
        const mfaTokenHash = createHash('sha256').update(mfaToken).digest('hex');
        // Store the mfa token in the IdempotencyRecord table — it's the right
        // shape (key, responseJson) and we get free TTL via a short customExpiry.
        // For simplicity, we use a 5-minute window via direct expiry check.
        await this.prisma.client.idempotencyRecord.create({
          data: {
            organizationId: org.id,
            key: `mfa:${mfaTokenHash}`,
            requestHash: user.id, // placeholder: identifies the user
            method: 'MFA',
            path: 'pending',
            statusCode: 0,
            responseJson: { userId: user.id } as any,
            status: 'pending',
          },
        });
        await this.recordAttempt(org.id, dto.email, true, true, ipAddress, userAgent, null);
        return { mfaToken, requiresMfa: true };
      }

      // No MFA → issue tokens directly.
      await this.recordAttempt(org.id, dto.email, true, false, ipAddress, userAgent, null);
      await this.recordSuccessfulLogin(user);
      return this.issueTokens(user, org.id, request, null);
    });
  }

  /**
   * Step 2 of login: exchange an mfaToken + TOTP code for full access +
   * refresh tokens. Mirrors the password flow: increments failed count on
   * mismatch, locks after MAX_FAILED_ATTEMPTS.
   */
  async mfaLogin(dto: MfaLoginDto, request?: Request): Promise<LoginResult> {
    const ipAddress = request?.ip;
    const userAgent = (request?.headers?.['user-agent'] as string | undefined) ?? null;
    const mfaTokenHash = createHash('sha256').update(dto.mfaToken).digest('hex');

    // Look up the pending mfa token (no tenant context yet — fetch raw).
    const pending = await this.prisma.raw.idempotencyRecord.findUnique({
      where: { organizationId_key: { organizationId: '', key: `mfa:${mfaTokenHash}` } },
    });
    if (!pending || pending.status !== 'pending') {
      throw new UnauthorizedException('MFA token invalid or expired');
    }
    // 5-minute MFA window.
    if (Date.now() - pending.createdAt.getTime() > 5 * 60 * 1000) {
      await this.prisma.raw.idempotencyRecord
        .delete({ where: { organizationId_key: { organizationId: pending.organizationId, key: `mfa:${mfaTokenHash}` } } })
        .catch(() => undefined);
      throw new UnauthorizedException('MFA token expired');
    }

    const userId = pending.requestHash; // we stashed userId here
    return this.tenant.run({ organizationId: pending.organizationId }, async () => {
      const user = (await this.prisma.client.user.findFirst({
        where: { id: userId, isActive: true },
        include: { roles: true },
      })) as UserWithRoles | null;

      if (!user || !user.mfaSecret) {
        throw new UnauthorizedException('MFA not enrolled');
      }
      const mfaSecret = readMfaSecret(user, this.encryption);
      if (!mfaSecret) {
        throw new UnauthorizedException('MFA misconfigured; contact your administrator');
      }

      const codeOk = this.mfa.verify(mfaSecret, dto.code);
      if (!codeOk) {
        await this.recordAttempt(pending.organizationId, user.email, false, true, ipAddress, userAgent, 'bad_mfa_code');
        await this.recordFailedLogin(user);
// Invalidate the mfaToken so the attacker can't keep guessing.
      await this.prisma.raw.idempotencyRecord
        .delete({ where: { organizationId_key: { organizationId: pending.organizationId, key: `mfa:${mfaTokenHash}` } } })
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid MFA code');
      }

      // Burn the mfaToken (single-use).
      await this.prisma.raw.idempotencyRecord
        .delete({ where: { organizationId_key: { organizationId: pending.organizationId, key: `mfa:${mfaTokenHash}` } } })
        .catch(() => undefined);

      await this.recordAttempt(pending.organizationId, user.email, true, true, ipAddress, userAgent, null);
      await this.recordSuccessfulLogin(user);
      return this.issueTokens(user, pending.organizationId, request, null);
    });
  }

  /** Enroll MFA for the currently authenticated user. Returns the QR + secret. */
  async enrollMfa(auth: AuthUser): Promise<{ secret: string; qrDataUrl: string }> {
    const user = await this.prisma.client.user.findFirst({ where: { id: auth.sub } });
    if (!user) throw new BadRequestException('User not found');
    if (user.mfaSecret) {
      throw new BadRequestException('MFA already enrolled; disable first');
    }
    const secret = this.mfa.generateSecret();
    // We persist the secret only after the user verifies with a code (see
    // verifyMfaEnrollment below) — so a stolen QR never activates MFA.
    // Store the secret encrypted-at-rest.
    const enc = this.encryption.encrypt(secret);
    await this.prisma.client.idempotencyRecord.create({
      data: {
        organizationId: user.organizationId,
        key: `mfa-enroll:${createHash('sha256').update(user.id).digest('hex')}`,
        requestHash: enc?.ciphertext ?? secret,
        method: 'MFA-ENROLL',
        path: 'pending',
        statusCode: 0,
        responseJson: { userId: user.id, iv: enc?.iv ?? null, tag: enc?.tag ?? null } as any,
        status: 'pending',
      },
    });
    const { qrDataUrl } = await this.mfa.buildEnrollmentQr(user.email, secret);
    return { secret, qrDataUrl };
  }

  /** Verify the user can produce a valid TOTP code, then persist the secret. */
  async verifyMfaEnrollment(auth: AuthUser, code: string): Promise<{ ok: true }> {
    const enrollKey = `mfa-enroll:${createHash('sha256').update(auth.sub).digest('hex')}`;
    const pending = await this.prisma.raw.idempotencyRecord.findUnique({ where: { organizationId_key: { organizationId: '', key: enrollKey } } });
    if (!pending || pending.status !== 'pending') {
      throw new BadRequestException('No MFA enrollment in progress');
    }
    // pending.responseJson holds the encrypted secret payload (iv, tag) we
    // generated when /mfa/enroll was called. Decrypt to verify the code.
    const stored = (pending.responseJson ?? {}) as { iv: string | null; tag: string | null };
    const ciphertext = pending.requestHash; // for legacy plaintext rows this equals the secret itself
    let secret: string;
    try {
      secret = stored.iv && stored.tag
        ? (this.encryption.decrypt({ ciphertext, iv: stored.iv, tag: stored.tag }) as string)
        : ciphertext;
    } catch {
      secret = ciphertext;
    }
    if (!this.mfa.verify(secret, code)) {
      throw new BadRequestException('Invalid TOTP code; scan the QR and retry');
    }
    // Re-encrypt and persist into the user record.
    const enc = this.encryption.encrypt(secret);
    await this.prisma.client.user.update({
      where: { id: auth.sub },
      data: {
        mfaSecret: enc?.ciphertext ?? secret,
        mfaSecretIv: enc?.iv ?? null,
        mfaSecretTag: enc?.tag ?? null,
        mfaEnrolledAt: new Date(),
      },
    });
    await this.prisma.raw.idempotencyRecord
      .delete({ where: { organizationId_key: { organizationId: pending.organizationId, key: enrollKey } } })
      .catch(() => undefined);
    return { ok: true };
  }

  async disableMfa(auth: AuthUser, code: string): Promise<{ ok: true }> {
    const user = await this.prisma.client.user.findFirst({ where: { id: auth.sub } });
    if (!user || !user.mfaSecret) throw new BadRequestException('MFA not enrolled');
    const secret = readMfaSecret(user, this.encryption);
    if (!secret || !this.mfa.verify(secret, code)) {
      throw new BadRequestException('Invalid TOTP code');
    }
    await this.prisma.client.user.update({
      where: { id: auth.sub },
      data: { mfaSecret: null, mfaSecretIv: null, mfaSecretTag: null, mfaEnrolledAt: null },
    });
    return { ok: true };
  }

  async refresh(dto: RefreshDto, request?: Request) {
    const presentedHash = hashRefreshToken(dto.refreshToken);
    // `/auth/refresh` is @Public, so there is no tenant context yet. Resolve the
    // org from the presented token via the raw client (which bypasses the
    // org-scoped Prisma extension), then run the rotation inside that org's
    // context. Without this, the org-scoped $transaction threw "No tenant
    // context" and refresh returned 500. Mirrors mfaLogin.
    const preload = await this.prisma.raw.refreshToken.findFirst({
      where: { tokenHash: presentedHash },
      select: { organizationId: true },
    });
    if (!preload) throw new UnauthorizedException('Invalid or expired refresh token');
    return this.tenant.run({ organizationId: preload.organizationId }, () =>
      this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.refreshToken.findFirst({
          where: { tokenHash: presentedHash },
          include: { user: { include: { roles: true } } },
        });
        if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
          throw new UnauthorizedException('Invalid or expired refresh token');
        }
        if (!existing.user || !existing.user.isActive) {
          throw new UnauthorizedException('User no longer active');
        }

        const replacement = newRefreshTokenValue();
        const newRow = await tx.refreshToken.create({
          data: {
            organizationId: existing.organizationId,
            userId: existing.userId,
            tokenHash: replacement.hash,
            expiresAt: replacement.expiresAt,
            deviceLabel: existing.deviceLabel,
            ipAddress: request?.ip ?? existing.ipAddress,
            userAgent: request?.headers?.['user-agent'] as string | undefined ?? existing.userAgent,
          },
        });
        await tx.refreshToken.update({
          where: { id: existing.id },
          data: { revokedAt: new Date(), replacedById: newRow.id },
        });

        const user = existing.user as UserWithRoles;
        const accessToken = this.jwt.signAccess({
          sub: user.id,
          organizationId: existing.organizationId,
          email: user.email,
          permissions: this.aggregatePermissions(user.roles),
        });
        const org = await this.prisma.raw.organization.findUnique({
          where: { id: existing.organizationId },
          select: { id: true, code: true, name: true, currencyCode: true, timezone: true },
        });
        return {
          accessToken,
          refreshToken: replacement.value,
          user: this.sanitize(user),
          permissions: this.aggregatePermissions(user.roles),
          organization: org ?? undefined,
        };
      }),
    );
  }

  async me(auth: AuthUser) {
    const user = (await this.prisma.client.user.findFirst({
      where: { id: auth.sub },
      include: { roles: true },
    })) as UserWithRoles | null;
    if (!user) throw new UnauthorizedException();
    return {
      ...this.sanitize(user),
      permissions: this.aggregatePermissions(user.roles),
      mfaEnrolled: !!user.mfaSecret,
    };
  }

  async listSessions(auth: AuthUser) {
    return this.prisma.client.refreshToken.findMany({
      where: { userId: auth.sub, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceLabel: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true },
    });
  }

  async revokeSession(auth: AuthUser, sessionId: string) {
    const token = await this.prisma.client.refreshToken.findFirst({ where: { id: sessionId, userId: auth.sub } });
    if (!token) throw new BadRequestException('Session not found');
    await this.prisma.client.refreshToken.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /** Authenticated password change — requires the current password and revokes
   * all active refresh tokens so every device must re-authenticate. */
  async changePassword(auth: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const user = (await this.prisma.client.user.findFirst({ where: { id: auth.sub } })) as UserWithRoles | null;
    if (!user) throw new BadRequestException('User not found');
    const ok = await this.password.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    const hash = await this.password.hash(newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: user.id },
        data: { passwordHash: hash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.client.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    // Was `await this.audit.recordInTx ? A : B` with A and B identical. `await`
    // bound to the method *reference* — always truthy — so the ternary was dead
    // and neither branch's promise was awaited, meaning a password change could
    // land without its audit row and reject unhandled. `recordInTx` needs a tx
    // and there is none here, so the fire-and-forget path was always correct;
    // it just has to be awaited.
    await this.audit.record({
      entity: 'User',
      entityId: user.id,
      action: 'update',
      newValues: { passwordChanged: true },
    });
    this.events.publish('user.password_changed' as any, {
      userId: user.id,
      organizationId: user.organizationId,
      at: new Date().toISOString(),
    });
  }

  private async recordAttempt(
    organizationId: string | null,
    email: string,
    success: boolean,
    mfaRequired: boolean,
    ipAddress: string | undefined,
    userAgent: string | null,
    reason: string | null,
  ): Promise<void> {
    try {
      await this.prisma.raw.loginAttempt.create({
        data: {
          organizationId: organizationId ?? undefined,
          email,
          success,
          mfaRequired,
          ipAddress: ipAddress ?? null,
          userAgent,
          reason,
        },
      });
    } catch (err) {
      // Don't fail the request because of a logging failure.
      this.logger.warn(`Failed to record login attempt: ${String(err)}`);
    }
  }

  /** Increment failed-login counter and lock if threshold exceeded. */
  private async recordFailedLogin(user: UserWithRoles | null): Promise<void> {
    if (!user) return;
    const next = user.failedLoginCount + 1;
    const locked = next >= MAX_FAILED_ATTEMPTS;
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: next,
        lockedUntil: locked ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    if (locked) {
      this.logger.warn(`User ${user.email} locked after ${next} failed attempts`);
      await this.recordAttempt(
        user.organizationId,
        user.email,
        false,
        !!user.mfaSecret,
        undefined,
        null,
        'account_locked',
      );
    }
  }

  private async recordSuccessfulLogin(user: UserWithRoles): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }

  private async issueTokens(
    user: UserWithRoles,
    organizationId: string,
    request: Request | undefined,
    _unused: unknown,
  ) {
    const permissions = this.aggregatePermissions(user.roles);
    const accessToken = this.jwt.signAccess({
      sub: user.id,
      organizationId,
      email: user.email,
      permissions,
    });

    const refresh = newRefreshTokenValue();
    await this.prisma.client.refreshToken.create({
      data: {
        organizationId,
        userId: user.id,
        tokenHash: refresh.hash,
        expiresAt: refresh.expiresAt,
        deviceLabel: (request?.headers?.['x-device-label'] as string | undefined) ?? null,
        ipAddress: request?.ip ?? null,
        userAgent: (request?.headers?.['user-agent'] as string | undefined) ?? null,
      },
    });

    await this.audit.record({ entity: 'User', entityId: user.id, action: 'login' });
    this.events.publish('user.logged_in', {
      userId: user.id,
      organizationId,
      at: new Date().toISOString(),
    });

    const org = await this.prisma.raw.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, code: true, name: true, currencyCode: true, timezone: true },
    });

    return {
      accessToken,
      refreshToken: refresh.value,
      user: this.sanitize(user),
      permissions,
      organization: org ?? undefined,
    };
  }

  private aggregatePermissions(roles: { permissions: string[] }[]): string[] {
    return [...new Set(roles.flatMap((r) => r.permissions))];
  }

  private sanitize(user: UserWithRoles) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles.map((r) => r.name),
      mfaEnrolled: !!user.mfaSecret,
    };
  }
}

interface LoginResult {
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string | null;
    roles: string[];
    mfaEnrolled: boolean;
    permissions?: string[];
  };
  permissions?: string[];
    organization?: {
      id: string;
      code: string;
      name: string;
      currencyCode: string;
      timezone: string;
    };
    mfaToken?: string;
    requiresMfa?: boolean;
  }