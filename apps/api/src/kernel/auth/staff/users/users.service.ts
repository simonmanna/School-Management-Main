import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role, User } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantContextService } from '../../../tenancy/tenant-context.service';
import { AuditService } from '../../../audit/audit.service';
import { EventBus } from '../../../events/event-bus';
import { PasswordService } from '../../password.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EVENTS } from '@erp/shared';

/** Public shape returned by the API — never includes passwordHash. */
export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  mfaEnrolled: boolean;
  createdAt: Date;
  updatedAt: Date;
  roles: { id: string; name: string }[];
}

/** Strip server-only fields from a User row. */
function toSafe(u: any): SafeUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName ?? null,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ?? null,
    failedLoginCount: u.failedLoginCount ?? 0,
    lockedUntil: u.lockedUntil ?? null,
    mfaEnrolled: !!u.mfaSecret,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roles: (u.roles ?? []).map((r: Role) => ({ id: r.id, name: r.name })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly password: PasswordService,
  ) {}

  async list(query: { search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Record<string, unknown> = {};
    if (query.search) {
      where.OR = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        include: { roles: { select: { id: true, name: true } } },
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.user.count({ where }),
    ]);
    return {
      data: data.map(toSafe),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findOne(id: string): Promise<SafeUser> {
    const user = await this.prisma.client.user.findFirst({
      where: { id },
      include: { roles: { select: { id: true, name: true } } },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return toSafe(user);
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const orgId = this.tenant.organizationId;
    if (!orgId) throw new ForbiddenException('Tenant context required');

    const existing = await this.prisma.client.user.findFirst({
      where: { organizationId: orgId, email: dto.email },
    });
    if (existing) throw new ConflictException(`A user with email "${dto.email}" already exists`);

    const roles = await this.resolveRoles(orgId, dto.roleIds);
    const passwordHash = await this.password.hash(dto.password);

    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: orgId,
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          isActive: dto.isActive ?? true,
          roles: { connect: roles.map((r) => ({ id: r.id })) },
        },
        include: { roles: { select: { id: true, name: true } } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'User',
        entityId: created.id,
        action: 'create',
        newValues: { id: created.id, email: created.email, firstName: created.firstName, roleIds: roles.map((r) => r.id) },
      });
      return created;
    });
    this.events.publish(EVENTS.UserCreated, { id: user.id, organizationId: orgId });
    return toSafe(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const current = await this.prisma.client.user.findFirst({
      where: { id },
      include: { roles: { select: { id: true } } },
    });
    if (!current) throw new NotFoundException(`User ${id} not found`);

    if (dto.email && dto.email !== current.email) {
      const collision = await this.prisma.client.user.findFirst({
        where: { organizationId: current.organizationId, email: dto.email, NOT: { id } },
      });
      if (collision) throw new ConflictException(`Email "${dto.email}" is already in use`);
    }

    let resolvedRoles: { id: string; name: string }[] | undefined;
    if (dto.roleIds) {
      // Prevent the last active administrator from losing the user:read perm.
      const roles = await this.resolveRoles(current.organizationId, dto.roleIds);
      await this.guardLastAdmin(id, roles.map((r) => r.id));
      resolvedRoles = roles.map((r) => ({ id: r.id, name: r.name }));
    }

    // Guard against self-demotion / self-deactivation.
    const actingUserId = this.tenant.userId;
    if (actingUserId === id) {
      if (dto.isActive === false) throw new ForbiddenException('You cannot deactivate your own account');
      if (resolvedRoles) {
        const stillAdmin = await this.userHoldsAdminRole(id, resolvedRoles.map((r) => r.id));
        if (!stillAdmin) throw new ForbiddenException('You cannot remove your own admin role');
      }
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const before = {
        email: current.email,
        firstName: current.firstName,
        lastName: current.lastName,
        isActive: current.isActive,
        roleIds: current.roles.map((r) => r.id),
      };
      await tx.user.updateMany({
        where: { id },
        data: {
          email: dto.email ?? undefined,
          firstName: dto.firstName ?? undefined,
          lastName: dto.lastName ?? undefined,
          isActive: dto.isActive ?? undefined,
        },
      });
      if (resolvedRoles) {
        await tx.user.update({ where: { id }, data: { roles: { set: resolvedRoles.map((r) => ({ id: r.id })) } } });
      }
      const after = await tx.user.findFirst({
        where: { id },
        include: { roles: { select: { id: true, name: true } } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'User',
        entityId: id,
        action: 'update',
        oldValues: before,
        newValues: {
          email: after!.email,
          firstName: after!.firstName,
          lastName: after!.lastName,
          isActive: after!.isActive,
          roleIds: after!.roles.map((r) => r.id),
        },
      });
      return after!;
    });
    this.events.publish(EVENTS.UserUpdated, { id, organizationId: current.organizationId });
    return toSafe(updated);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    const passwordHash = await this.password.hash(newPassword);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
      // Revoke all refresh tokens so every device must re-authenticate.
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.recordInTx(tx, {
        entity: 'User',
        entityId: id,
        action: 'update',
        newValues: { passwordReset: true, allSessionsRevoked: true },
      });
    });
    this.events.publish(EVENTS.UserPasswordReset, { id, organizationId: user.organizationId });
  }

  async unlock(id: string): Promise<SafeUser> {
    const user = await this.prisma.client.user.findFirst({
      where: { id },
      include: { roles: { select: { id: true, name: true } } },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const after = await tx.user.findFirst({
        where: { id },
        include: { roles: { select: { id: true, name: true } } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'User',
        entityId: id,
        action: 'update',
        newValues: { unlocked: true, failedLoginCount: 0 },
      });
      return after!;
    });
    this.events.publish(EVENTS.UserUnlocked, { id, organizationId: user.organizationId });
    return toSafe(updated);
  }

  async remove(id: string): Promise<void> {
    const current = await this.prisma.client.user.findFirst({
      where: { id },
      include: { roles: { select: { id: true, name: true } } },
    });
    if (!current) throw new NotFoundException(`User ${id} not found`);
    if (id === this.tenant.userId) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    await this.guardLastAdmin(id, current.roles.map((r) => r.id));

    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      // Revoke active sessions.
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.recordInTx(tx, {
        entity: 'User',
        entityId: id,
        action: 'delete',
        oldValues: { email: current.email, firstName: current.firstName },
      });
    });
    this.events.publish(EVENTS.UserDeleted, { id, organizationId: current.organizationId });
  }

  // ---- helpers ----

  private async resolveRoles(orgId: string, roleIds: string[]) {
    if (roleIds.length === 0) {
      // Empty assignment is allowed (a user with no roles has no permissions).
      return [];
    }
    const roles = await this.prisma.client.role.findMany({
      where: { id: { in: roleIds }, organizationId: orgId },
    });
    if (roles.length !== roleIds.length) {
      const found = new Set(roles.map((r) => r.id));
      const missing = roleIds.filter((id) => !found.has(id));
      throw new BadRequestException(`Unknown role id(s) for this organization: ${missing.join(', ')}`);
    }
    return roles;
  }

  /** Refuse to drop the last active admin (a user holding any role whose
   *  permissions include `user:update` or `role:update`). Prevents the
   *  organization from locking itself out. */
  private async guardLastAdmin(targetUserId: string, remainingRoleIds: string[]) {
    const adminPerms = ['user:update', 'role:update'];
    const stillHasAdmin = await this.prisma.client.role.findFirst({
      where: { id: { in: remainingRoleIds }, permissions: { hasSome: adminPerms } },
      select: { id: true },
    });
    if (stillHasAdmin) return; // this user still has admin

    // Find any OTHER active user (org-scoped) that still has an admin role.
    const otherAdmins = await this.prisma.client.user.findFirst({
      where: {
        id: { not: targetUserId },
        isActive: true,
        deletedAt: null,
        roles: { some: { permissions: { hasSome: adminPerms } } },
      },
      select: { id: true },
    });
    if (!otherAdmins) {
      throw new ForbiddenException(
        'Refusing to remove the last administrator. Promote another user to an admin role first.',
      );
    }
  }

  private async userHoldsAdminRole(userId: string, roleIds: string[]): Promise<boolean> {
    const adminPerms = ['user:update', 'role:update'];
    const found = await this.prisma.client.role.findFirst({
      where: { id: { in: roleIds }, permissions: { hasSome: adminPerms } },
      select: { id: true },
    });
    return !!found;
  }
}
