/**
 * POS Tables Management — configurable zones (categories) (ADR-012 extension).
 *
 * A zone is a per-organization dining area (Indoor, Outdoor, Rooftop, ...).
 * `PosTable.zone` stores the zone KEY (stable slug). This service owns the
 * zone catalog lifecycle:
 *   - lazy-seeds the 6 default zones for any org that has none yet
 *     (self-healing for orgs created before this feature shipped)
 *   - soft-delete convention (Menu Category pattern): DELETE archives,
 *     PATCH :id/restore brings back, GET /deleted lists archived rows
 *   - archiving a zone with active tables referencing it is refused (409)
 *
 * The zone key is immutable after creation (PosTable.zone + reports group by
 * it); rename only changes the display label.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';

export interface CreateZoneDto {
  key?: string;
  name: string;
  sortOrder?: number;
  color?: string;
  active?: boolean;
}

export interface UpdateZoneDto extends Partial<CreateZoneDto> {}

/** Default zone catalog provisioned for every new / empty organization. */
export const DEFAULT_ZONES: ReadonlyArray<{
  key: string;
  name: string;
  sortOrder: number;
  color: string;
}> = [
  { key: 'indoor', name: 'Indoor', sortOrder: 1, color: '#10b981' },
  { key: 'outdoor', name: 'Outdoor', sortOrder: 2, color: '#f59e0b' },
  { key: 'terrace', name: 'Terrace', sortOrder: 3, color: '#fb923c' },
  { key: 'vip', name: 'VIP', sortOrder: 4, color: '#a855f7' },
  { key: 'garden', name: 'Garden', sortOrder: 5, color: '#22c55e' },
  { key: 'bar', name: 'Bar', sortOrder: 6, color: '#ec4899' },
];

/** Deterministic slug used to derive a zone key from its name. */
export function slugifyZoneKey(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'zone';
}

@Injectable()
export class PosTableZonesService {
  private readonly logger = new Logger('PosTableZonesService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  private userId(): string | null {
    return this.tenant.userId ?? null;
  }

  private publish(organizationId: string, extra: Record<string, unknown> = {}) {
    this.events.publish(EVENTS.PosTableUpdated, {
      organizationId,
      tableId: '', // zone catalog changes broadcast to all table consumers
      changes: { zones: true, ...extra },
    });
  }

  /** Provision the default zones for orgs that have none yet (idempotent). */
  async ensureDefaults(organizationId: string): Promise<void> {
    const count = await this.prisma.client.posTableZone.count({
      where: { organizationId },
    });
    if (count > 0) return;
    await this.prisma.client.posTableZone.createMany({
      data: DEFAULT_ZONES.map((z) => ({
        organizationId,
        key: z.key,
        name: z.name,
        sortOrder: z.sortOrder,
        color: z.color,
        active: true,
        createdBy: this.userId(),
        updatedBy: this.userId(),
      })),
    });
    this.publish(organizationId, { zonesSeeded: true });
  }

  /** Active (non-deleted) zones, ordered by sortOrder then name. */
  async list() {
    const organizationId = this.tenant.organizationId;
    await this.ensureDefaults(organizationId);
    return this.prisma.client.posTableZone.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Soft-deleted zones, newest first (restore candidates). */
  async listDeleted() {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.posTableZone.findMany({
      where: { organizationId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async create(dto: CreateZoneDto) {
    const organizationId = this.tenant.organizationId;
    if (!dto.name?.trim()) throw new BadRequestException('Zone name is required');
    const key = (dto.key?.trim() || slugifyZoneKey(dto.name)).toLowerCase();
    try {
      const created = await this.prisma.client.$transaction(async (tx: any) => {
        const zone = await tx.posTableZone.create({
          data: {
            organizationId,
            key,
            name: dto.name.trim(),
            sortOrder: dto.sortOrder ?? 0,
            color: dto.color?.trim() || '#10b981',
            active: dto.active ?? true,
            createdBy: this.userId(),
            updatedBy: this.userId(),
          },
        });
        await this.audit.recordInTx(tx, {
          entity: 'PosTableZone',
          entityId: zone.id,
          action: 'create',
          newValues: { key: zone.key, name: zone.name, sortOrder: zone.sortOrder, color: zone.color },
        });
        return zone;
      });
      this.publish(organizationId, { zoneCreated: created.key });
      return created;
    } catch (e: any) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Zone key "${key}" already exists`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateZoneDto) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.posTableZone.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Zone not found');

    if (dto.key !== undefined && dto.key.trim() !== existing.key) {
      throw new BadRequestException(
        'Zone key cannot be changed — tables reference it. Archive and recreate instead.',
      );
    }
    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('Zone name cannot be empty');
    }

    const changes: Record<string, unknown> = {};
    const fields: (keyof UpdateZoneDto)[] = ['name', 'sortOrder', 'color', 'active'];
    for (const f of fields) {
      if (dto[f] !== undefined && (existing as any)[f] !== dto[f]) {
        changes[f as string] = { from: (existing as any)[f], to: dto[f] };
      }
    }

    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const zone = await tx.posTableZone.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.color !== undefined ? { color: dto.color.trim() } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          updatedBy: this.userId(),
        },
      });
      if (Object.keys(changes).length > 0) {
        await this.audit.recordInTx(tx, {
          entity: 'PosTableZone',
          entityId: id,
          action: 'update',
          oldValues: { ...changes },
        });
      }
      return zone;
    });
    this.publish(organizationId, { zoneUpdated: updated.key });
    return updated;
  }

  /**
   * Soft-archive a zone. Refused while active tables still reference it —
   * reassign those tables first (table edit), then archive.
   */
  async archive(id: string) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.posTableZone.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Zone not found');
    if (existing.deletedAt) return existing; // idempotent

    const refCount = await this.prisma.client.posTable.count({
      where: { organizationId, zone: existing.key, active: true },
    });
    if (refCount > 0) {
      throw new ConflictException(
        `Zone "${existing.name}" has ${refCount} active table${refCount === 1 ? '' : 's'} — reassign them before archiving`,
      );
    }

    const archived = await this.prisma.client.$transaction(async (tx: any) => {
      const zone = await tx.posTableZone.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: this.userId() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'PosTableZone',
        entityId: id,
        action: 'delete',
        oldValues: { key: existing.key, name: existing.name },
      });
      return zone;
    });
    this.publish(organizationId, { zoneArchived: existing.key });
    return archived;
  }

  /** Restore a soft-deleted zone (Menu Category pattern). */
  async restore(id: string) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.posTableZone.findFirst({
      where: { id, organizationId, deletedAt: { not: null } },
    });
    if (!existing) throw new NotFoundException('Archived zone not found');

    const restored = await this.prisma.client.$transaction(async (tx: any) => {
      // updateMany (not update): the soft-delete extension injects
      // where.deletedAt = null into `update` — which would P2025 a row that
      // IS deleted. An explicit deletedAt: { not: null } where keeps the
      // extension from injecting, and matches exactly the archived row.
      const result = await tx.posTableZone.updateMany({
        where: { id, organizationId, deletedAt: { not: null } },
        data: { deletedAt: null, updatedBy: this.userId() },
      });
      if (result.count === 0) throw new NotFoundException('Archived zone not found');
      const zone = await tx.posTableZone.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'PosTableZone',
        entityId: id,
        action: 'restore',
        newValues: { key: existing.key, name: existing.name },
      });
      return zone;
    });
    this.publish(organizationId, { zoneRestored: existing.key });
    return restored;
  }

  /**
   * Resolve a zone key to its row for the org (active only). Used by
   * PosTablesService to validate `zone` on table create/update.
   */
  async resolveKey(organizationId: string, key: string): Promise<{ key: string; name: string; color: string } | null> {
    const zone = await this.prisma.client.posTableZone.findFirst({
      where: { organizationId, key, deletedAt: null, active: true },
      select: { key: true, name: true, color: true },
    });
    return zone;
  }

  /** Bulk zone metadata for join enrichment (name + color by key). */
  async mapForOrganization(organizationId: string): Promise<Map<string, { name: string; color: string }>> {
    const zones = await this.prisma.client.posTableZone.findMany({
      where: { organizationId, deletedAt: null },
      select: { key: true, name: true, color: true },
    });
    return new Map(zones.map((z) => [z.key, { name: z.name, color: z.color }]));
  }
}
