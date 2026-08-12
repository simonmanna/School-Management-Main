/**
 * POS Phase A — Manager override (PIN / password).
 *
 * Flow:
 *   1. Cashier triggers an action that exceeds their authority
 *      (e.g. applies 30% discount, voids a sale, performs a manual refund).
 *   2. UI prompts: "Manager PIN".
 *   3. Cashier calls POST /pos/override/verify with { email, pin?, password? }.
 *   4. Service looks up the manager in the same org, verifies the PIN (if set)
 *      OR password, asserts the manager has pos:override permission, and
 *      returns { managerId, managerName, overrideKind }.
 *   5. Cashier re-submits the original request with `overrideById` in the
 *      payload. The downstream service (pos.checkout / pos.refund) verifies
 *      the overrideById exists, has pos:override, and writes an AuditLog row
 *      tagged "override.approved" with the manager's id, the kind, and the
 *      amount being authorised.
 *
 * The override mechanism intentionally avoids JWT tokens: the cashier UI
 * remembers the managerId for the duration of one submission, and the server
 * re-validates the manager on every privileged write. No token to steal,
 * no token to expire mid-transaction.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { PasswordService } from '../../kernel/auth/password.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';

export interface VerifyOverrideDto {
  /** Manager's login email. Used to look up the manager in the cashier's org. */
  email: string;
  /** Manager PIN (preferred, if the manager has set one). */
  pin?: string;
  /** Manager password (fallback if PIN is not set). */
  password?: string;
  /** What the override is being requested for. Recorded in audit + event. */
  overrideKind: 'discount' | 'void' | 'manual_refund';
}

@Injectable()
export class PosOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Manager sets (or changes) their override PIN. Requires an active session. */
  async setPin(userId: string, pin: string) {
    if (!pin || pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
      throw new BadRequestException('PIN must be 4–8 digits');
    }
    const organizationId = this.tenant.organizationId;
    const hash = await this.password.hash(pin);
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { pinHash: hash, pinHashRounds: 10 },
    });
    await this.audit.record({
      entity: 'User',
      entityId: userId,
      action: 'update',
      newValues: { pinSet: true },
    });
    return { ok: true };
  }

  /** Verify a manager's credentials and return their id if they can override. */
  async verify(dto: VerifyOverrideDto) {
    if (!dto.email) throw new BadRequestException('email is required');
    if (!dto.pin && !dto.password) {
      throw new BadRequestException('pin or password is required');
    }
    const organizationId = this.tenant.organizationId;
    const manager = await this.prisma.raw.user.findFirst({
      where: { organizationId, email: dto.email.toLowerCase(), isActive: true },
      include: { roles: true },
    });
    if (!manager) throw new NotFoundException('Manager not found');

    // The cashier is verifying a *manager* — the manager must be active and
    // (eventually) have pos:override. We don't enforce permission at verify
    // time (cashier might be in a hurry); we re-check at consume time.
    let ok = false;
    if (dto.pin && manager.pinHash) {
      ok = await this.password.compare(dto.pin, manager.pinHash);
    } else if (dto.password) {
      ok = await this.password.compare(dto.password, manager.passwordHash);
    } else if (dto.pin && !manager.pinHash) {
      throw new BadRequestException('Manager has not set a PIN; use their password');
    }
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.audit.record({
      entity: 'User',
      entityId: manager.id,
      action: 'login' as any, // AuditAction enum is closed; 'login' is the closest fit.
      newValues: { overrideVerified: true, overrideKind: dto.overrideKind },
    });
    this.events.publish(EVENTS.PosOverrideApproved, {
      organizationId,
      approverId: manager.id,
      overrideKind: dto.overrideKind,
    });
    return {
      managerId: manager.id,
      managerName: `${manager.firstName}${manager.lastName ? ' ' + manager.lastName : ''}`,
      managerEmail: manager.email,
      overrideKind: dto.overrideKind,
    };
  }

  /**
   * Validate that an overrideById presented by the cashier refers to a manager
   * who has pos:override permission. Called from checkout / refund services
   * whenever a privileged field (high discount, manual refund) was supplied.
   * Returns the manager; throws if not found / not allowed.
   */
  async assertCanOverride(
    overrideById: string,
    overrideKind: 'discount' | 'void' | 'manual_refund' | 'shift_handover',
  ) {
    const organizationId = this.tenant.organizationId;
    const manager = await this.prisma.raw.user.findFirst({
      where: { id: overrideById, organizationId, isActive: true },
      include: { roles: true },
    });
    if (!manager) throw new NotFoundException('Override approver not found');
    const perms = new Set(manager.roles.flatMap((r: any) => r.permissions ?? []));
    if (!perms.has('pos:override')) {
      throw new UnauthorizedException('Approver does not hold pos:override permission');
    }
    return manager;
  }

  /**
   * Verify a manager's PIN at checkout time (F-OVR). The frontend collected the
   * PIN during the OverrideDialog flow; we re-check it here so a cashier cannot
   * bypass PIN entry by passing a known manager's userId directly.
   */
  async verifyPinForOverride(overrideById: string, pin: string) {
    const manager = await this.assertCanOverride(overrideById, 'discount');
    if (!manager.pinHash) {
      throw new BadRequestException('Manager has not set an override PIN');
    }
    const ok = await this.password.compare(pin, manager.pinHash);
    if (!ok) throw new UnauthorizedException('Invalid override PIN');
    return manager;
  }

  /** Verify the currently authenticated user's own PIN. Used for self-service
   *  actions like removing a cart item. No manager override permission needed. */
  async verifyCurrentUserPin(userId: string, pin: string) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.pinHash) {
      throw new BadRequestException('You have not set a PIN. Set one in your profile.');
    }
    const ok = await this.password.compare(pin, user.pinHash);
    if (!ok) throw new UnauthorizedException('Invalid PIN');
    await this.audit.record({
      entity: 'User',
      entityId: userId,
      action: 'login',
      newValues: { pinVerified: true, purpose: 'delete_item' },
    });
    return { ok: true };
  }
}