/**
 * POS PIN authentication service.
 *
 * Verifies a cashier's POS PIN (stored in User.pinHash, bcrypt).
 * Returns user info + aggregated permissions for the frontend store.
 *
 * Rate-limits failed attempts and locks the account after MAX_FAILED_ATTEMPTS
 * to prevent brute-force attacks on the 4-8 digit PIN.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventBus } from '../../kernel/events/event-bus';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { PasswordService } from '../../kernel/auth/password.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { JwtTokenService } from '../../kernel/auth/jwt-token.service';

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min

@Injectable()
export class PosAuthService {
  private readonly logger = new Logger(PosAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
    private readonly jwt: JwtTokenService,
    private readonly events: EventBus,
  ) {}

  /** List active staff in this org for POS PIN login. */
  async listStaff() {
    const organizationId = this.tenant.organizationId;
    const users = await this.prisma.client.user.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        pinHash: true,
        roles: { select: { name: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      hasPin: !!u.pinHash,
      roles: u.roles.map((r) => r.name),
    }));
  }

  /** Verify POS PIN and return user info + permissions. */
  async pinLogin(userId: string, pin: string) {
    const organizationId = this.tenant.organizationId;

    const user = await this.prisma.raw.user.findFirst({
      where: { id: userId, organizationId, isActive: true, deletedAt: null },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Staff not found');

    // Check if account is temporarily locked
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000 / 60);
      throw new UnauthorizedException(`Account locked. Try again in ${remaining} min`);
    }

    // Verify PIN
    if (!user.pinHash) {
      throw new UnauthorizedException('No POS PIN set. Ask a manager to set one.');
    }
    const ok = await this.password.compare(pin, user.pinHash);
    if (!ok) {
      await this.recordFailedAttempt(user);
      throw new UnauthorizedException('Invalid PIN');
    }

    // Successful login — reset counter
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.recordAttempt(user.organizationId, user.email, true, null);

    // Aggregate permissions from all roles
    const permissions = [...new Set<string>(user.roles.flatMap((r: any) => r.permissions ?? []))];

    // Mint a short-lived POS token. The terminal sends it on the `X-Pos-User`
    // header so the server attributes POS writes (sales, receipts, cash, audit)
    // to THIS cashier rather than the back-office user who opened the terminal.
    const posToken = this.jwt.signPos({
      sub: user.id,
      organizationId: user.organizationId,
      email: user.email,
      permissions,
    });

    // Audit login
    await this.audit.record({
      entity: 'User',
      entityId: user.id,
      action: 'login' as any,
      newValues: { posLogin: true },
    });

    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      permissions,
      posToken,
    };
  }

  // ─── private helpers ──────────────────────────────────────────────────────

  private async recordFailedAttempt(user: any): Promise<void> {
    const next = (user.failedLoginCount ?? 0) + 1;
    const locked = next >= MAX_FAILED_ATTEMPTS;
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: next,
        lockedUntil: locked ? new Date(Date.now() + LOCKOUT_DURATION_MS) : undefined,
      },
    });
    const reason = locked ? 'account_locked' : 'invalid_pin';
    await this.recordAttempt(user.organizationId, user.email, false, reason);
    if (locked) {
      this.logger.warn(`User ${user.email} POS PIN locked after ${next} failed attempts`);
    }
  }

  private async recordAttempt(organizationId: string, email: string, success: boolean, reason: string | null): Promise<void> {
    try {
      await this.prisma.client.loginAttempt.create({
        data: { organizationId, email, success, reason, createdAt: new Date() },
      });
    } catch {
      // Don't fail the request because of a logging failure.
    }
  }

  async changePin(userId: string, currentPin: string, newPin: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) throw new BadRequestException('No POS PIN set. Use the PIN login screen to set one first.');
    const ok = await this.password.compare(currentPin, user.pinHash);
    if (!ok) throw new BadRequestException('Current PIN is incorrect');
    if (currentPin === newPin) throw new BadRequestException('New PIN must be different from the current PIN');
    const hash = await this.password.hash(newPin);
    await this.prisma.client.user.update({ where: { id: userId }, data: { pinHash: hash } });
    await this.audit.record({ entity: 'User', entityId: userId, action: 'update', newValues: { posPinChanged: true } });
    this.events.publish('user.pos_pin_changed' as any, { userId, organizationId: user.organizationId, at: new Date().toISOString() });
  }

  async changePassword(userId: string, currentPin: string, newPassword: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) throw new BadRequestException('No POS PIN set. Ask a manager.');
    const ok = await this.password.compare(currentPin, user.pinHash);
    if (!ok) throw new BadRequestException('PIN is incorrect');
    const hash = await this.password.hash(newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({
        where: { id: userId },
        data: { passwordHash: hash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.client.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ entity: 'User', entityId: userId, action: 'update', newValues: { passwordChanged: true } });
    this.events.publish('user.password_changed' as any, { userId, organizationId: user.organizationId, at: new Date().toISOString() });
  }
}
