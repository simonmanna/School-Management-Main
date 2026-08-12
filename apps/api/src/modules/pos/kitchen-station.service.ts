/**
 * POS KDS — configurable kitchen stations.
 *
 * Replaces the old fixed `PosStation` enum (bar/kitchen/cafe) with a per-org
 * table so a business can define its own prep stations (Coffee, Bakery, Grill,
 * Pizza, Dessert, …). Products route to a station by its stable `code`; the KDS
 * renders one screen/column per station.
 *
 * Every org is seeded with three defaults (bar/kitchen/cafe) so existing
 * `Product.station` codes keep resolving after the enum→string migration.
 *
 * All DB work runs inside the tenant `$transaction` (PrismaService injects
 * `SET LOCAL app.org_id`), so these queries satisfy the table's tenant-isolation
 * RLS policy whether RLS is enabled or inert — no reliance on RLS being off.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

export interface KitchenStationView {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  printerId: string | null;
}

/** The three stations seeded for every org, so legacy Product.station codes resolve. */
export const DEFAULT_STATIONS: Array<{ name: string; code: string; color: string; icon: string; displayOrder: number; isDefault: boolean }> = [
  { name: 'Kitchen', code: 'kitchen', color: '#f43f5e', icon: 'ChefHat', displayOrder: 0, isDefault: false },
  { name: 'Bar', code: 'bar', color: '#f59e0b', icon: 'Coffee', displayOrder: 1, isDefault: false },
  { name: 'Cafe', code: 'cafe', color: '#10b981', icon: 'Sandwich', displayOrder: 2, isDefault: true },
];

const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

@Injectable()
export class KitchenStationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private serialize = (s: any): KitchenStationView => ({
    id: s.id,
    name: s.name,
    code: s.code,
    color: s.color ?? null,
    icon: s.icon ?? null,
    displayOrder: s.displayOrder,
    isActive: s.isActive,
    isDefault: s.isDefault,
    printerId: s.printerId ?? null,
  });

  /** Run a unit of work inside the tenant transaction (sets app.org_id GUC). */
  private tx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(fn);
  }

  private async createDefaults(tx: any): Promise<void> {
    const orgId = this.tenant.organizationId;
    for (const d of DEFAULT_STATIONS) {
      const existing = await tx.kitchenStation.findFirst({ where: { code: d.code } });
      if (existing) continue;
      await tx.kitchenStation.create({ data: { organizationId: orgId, ...d } });
    }
  }

  /** All (non-deleted) stations for the org, ordered for the tabs/board. */
  async list(includeInactive = true): Promise<KitchenStationView[]> {
    return this.tx(async (tx) => {
      const query = () => tx.kitchenStation.findMany({
        where: { ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      });
      let rows = await query();
      // Self-heal: an org that predates station config (or a fresh DB not yet
      // reseeded) gets the three defaults on first read so routing/tabs work.
      if (rows.length === 0) {
        await this.createDefaults(tx);
        rows = await query();
      }
      return (rows as any[]).map(this.serialize);
    });
  }

  /** Idempotently seed the three default stations for the current org. */
  async ensureDefaults(): Promise<void> {
    await this.tx((tx) => this.createDefaults(tx));
  }

  async create(dto: {
    name: string; code: string; color?: string; icon?: string;
    displayOrder?: number; isDefault?: boolean; printerId?: string;
  }): Promise<KitchenStationView> {
    const orgId = this.tenant.organizationId;
    const code = (dto.code ?? '').trim().toLowerCase();
    if (!CODE_RE.test(code)) {
      throw new BadRequestException('Station code must be lowercase letters/numbers/-/_ (max 32 chars).');
    }
    const result = await this.tx(async (tx) => {
      // Revive a soft-deleted station with the same code rather than colliding on
      // the (organizationId, code) unique index. Raw query bypasses the soft-delete
      // filter; app.org_id is set so RLS + the org predicate both scope it.
      const dead = await tx.$queryRawUnsafe(
        'SELECT id FROM "KitchenStation" WHERE "organizationId" = $1 AND code = $2 AND "deletedAt" IS NOT NULL LIMIT 1',
        orgId, code,
      );
      if (Array.isArray(dead) && dead.length > 0) {
        return tx.kitchenStation.update({
          where: { id: (dead[0] as any).id },
          data: {
            deletedAt: null, name: dto.name.trim(), color: dto.color ?? null,
            icon: dto.icon ?? null, displayOrder: dto.displayOrder ?? 0,
            isActive: true, printerId: dto.printerId ?? null,
          },
        });
      }
      const live = await tx.kitchenStation.findFirst({ where: { code } });
      if (live) throw new BadRequestException(`A station with code "${code}" already exists.`);
      return tx.kitchenStation.create({
        data: {
          organizationId: orgId, name: dto.name.trim(), code, color: dto.color ?? null,
          icon: dto.icon ?? null, displayOrder: dto.displayOrder ?? 0, isDefault: false,
          printerId: dto.printerId ?? null,
        },
      });
    });
    if (dto.isDefault) await this.setDefault(result.id);
    await this.audit.record({ entity: 'KitchenStation', entityId: result.id, action: 'create' as any, newValues: { code } });
    return this.getView(result.id);
  }

  /** Update editable fields. `code` is immutable (it's the routing key). */
  async update(id: string, dto: {
    name?: string; color?: string | null; icon?: string | null;
    displayOrder?: number; isActive?: boolean; isDefault?: boolean; printerId?: string | null;
  }): Promise<KitchenStationView> {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.printerId !== undefined) data.printerId = dto.printerId;
    await this.tx(async (tx) => {
      const s = await tx.kitchenStation.findFirst({ where: { id } });
      if (!s) throw new NotFoundException('Kitchen station not found');
      if (Object.keys(data).length) await tx.kitchenStation.update({ where: { id }, data });
    });
    if (dto.isDefault) await this.setDefault(id);
    await this.audit.record({ entity: 'KitchenStation', entityId: id, action: 'update' as any, newValues: data });
    return this.getView(id);
  }

  /** Persist a new tab/column order from an ordered id list. */
  async reorder(orderedIds: string[]): Promise<KitchenStationView[]> {
    await this.tx(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.kitchenStation.updateMany({ where: { id: orderedIds[i] }, data: { displayOrder: i } });
      }
    });
    return this.list();
  }

  /** Exactly one default station per org (the routing fallback). */
  async setDefault(id: string): Promise<void> {
    await this.tx(async (tx) => {
      const s = await tx.kitchenStation.findFirst({ where: { id } });
      if (!s) throw new NotFoundException('Kitchen station not found');
      await tx.kitchenStation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.kitchenStation.update({ where: { id }, data: { isDefault: true } });
    });
  }

  /** Soft-delete. The default station cannot be deleted (it's the fallback). */
  async remove(id: string): Promise<{ id: string }> {
    const code = await this.tx(async (tx) => {
      const s = await tx.kitchenStation.findFirst({ where: { id } });
      if (!s) throw new NotFoundException('Kitchen station not found');
      if (s.isDefault) throw new BadRequestException('Cannot delete the default station. Set another station as default first.');
      await tx.kitchenStation.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      return s.code;
    });
    await this.audit.record({ entity: 'KitchenStation', entityId: id, action: 'delete' as any, newValues: { code } });
    return { id };
  }

  private async getView(id: string): Promise<KitchenStationView> {
    const s = await this.tx((tx) => tx.kitchenStation.findFirst({ where: { id } }));
    if (!s) throw new NotFoundException('Kitchen station not found');
    return this.serialize(s);
  }
}
