import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import { EventBus } from '../../../events/event-bus';
import { TenantContextService } from '../../../tenancy/tenant-context.service';
import { DataScopeService } from '../../data-scope.service';
import { ALL_PERMISSIONS, EVENTS } from '@erp/shared';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

/** Build the set of valid permission keys from the shared catalog once at
 *  module load. Cheap, and gives precise errors for unknown keys. */
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * RBAC role management. Scoped to the current organization via the
 * tenant-aware Prisma extension. System roles (e.g. "Administrator") are
 * seeded by default but are editable/deletable like any other role.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly tenant: TenantContextService,
    private readonly dataScope: DataScopeService,
  ) {}

  async list(): Promise<Role[]> {
    const rows = await this.prisma.client.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return rows;
  }

  async findOne(id: string): Promise<Role & { _count: { users: number } }> {
    const row = await this.prisma.client.role.findFirst({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!row) throw new NotFoundException(`Role ${id} not found`);
    return row as any;
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    this.validatePermissions(dto.permissions);
    // Privilege-escalation guard: an actor may only grant permissions they
    // themselves hold, and only a scope no wider than their own. Administrator
    // holds everything (incl. `*`) so this is a no-op for them; seed/provisioning
    // paths bypass this method and are unaffected.
    const actorPerms = this.tenant.permissions;
    const missing = dto.permissions.filter((p) => !actorPerms.includes(p) && p !== '*');
    if (missing.length > 0 && !actorPerms.includes('*')) {
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${missing.join(', ')}`,
      );
    }
    if (dto.dataScope && !(await this.dataScope.canGrantScope(dto.dataScope))) {
      throw new ForbiddenException(
        `You cannot assign a data scope wider than your own (${dto.dataScope})`,
      );
    }

    const orgId = this.tenant.organizationId;
    if (!orgId) throw new ForbiddenException('Tenant context required');

    const existing = await this.prisma.client.role.findFirst({
      where: { organizationId: orgId, name: dto.name },
    });
    if (existing) throw new ConflictException(`Role "${dto.name}" already exists`);

    const role = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          permissions: dto.permissions,
          isSystem: dto.isSystem ?? false,
          dataScope: dto.dataScope ?? 'school',
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Role',
        entityId: created.id,
        action: 'create',
        newValues: { id: created.id, name: created.name, permissions: created.permissions, dataScope: created.dataScope },
      });
      return created;
    });
    this.events.publish(EVENTS.RoleCreated, { id: role.id, organizationId: orgId });
    return role;
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const current = await this.prisma.client.role.findFirst({ where: { id } });
    if (!current) throw new NotFoundException(`Role ${id} not found`);
    if (dto.permissions) this.validatePermissions(dto.permissions);

    // Privilege-escalation guard (see create()).
    if (dto.permissions) {
      const actorPerms = this.tenant.permissions;
      const missing = dto.permissions.filter((p) => !actorPerms.includes(p) && p !== '*');
      if (missing.length > 0 && !actorPerms.includes('*')) {
        throw new ForbiddenException(
          `You cannot grant permissions you do not hold: ${missing.join(', ')}`,
        );
      }
    }
    if (dto.dataScope && !(await this.dataScope.canGrantScope(dto.dataScope))) {
      throw new ForbiddenException(
        `You cannot assign a data scope wider than your own (${dto.dataScope})`,
      );
    }

    if (dto.name && dto.name !== current.name) {
      const collision = await this.prisma.client.role.findFirst({
        where: { organizationId: current.organizationId, name: dto.name, NOT: { id } },
      });
      if (collision) throw new ConflictException(`Role "${dto.name}" already exists`);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const before = { ...current };
      await tx.role.updateMany({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          description: dto.description ?? undefined,
          permissions: dto.permissions ?? undefined,
          dataScope: dto.dataScope ?? undefined,
        },
      });
      const after = await tx.role.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'Role',
        entityId: id,
        action: 'update',
        oldValues: {
          name: before.name,
          permissions: before.permissions,
          description: before.description,
          dataScope: before.dataScope,
        },
        newValues: {
          name: after!.name,
          permissions: after!.permissions,
          description: after!.description,
          dataScope: after!.dataScope,
        },
      });
      return after!;
    });
    this.events.publish(EVENTS.RoleUpdated, { id, organizationId: current.organizationId });
    return updated;
  }

  async remove(id: string): Promise<void> {
    const role = await this.prisma.client.role.findFirst({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    if (role._count.users > 0) {
      throw new ConflictException(
        `Role "${role.name}" is assigned to ${role._count.users} user(s); reassign them first`,
      );
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'Role',
        entityId: id,
        action: 'delete',
        oldValues: { id, name: role.name },
      });
    });
    this.events.publish(EVENTS.RoleDeleted, { id, organizationId: role.organizationId });
  }

  private validatePermissions(perms: string[]): void {
    const unknown = perms.filter((p) => !PERMISSION_SET.has(p));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}. Use keys from the permission catalog.`,
      );
    }
  }
}
