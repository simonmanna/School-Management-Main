import { OnModuleInit } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import type { ActivityPlugin, PluginCtx, PluginFeatures } from '../plugin.types';

/**
 * Shared plumbing for activity plugins (ADR-014 §4). A concrete plugin sets `type`,
 * `features` and its instance `table`, and implements only the parts that differ:
 * createInstance / updateInstance / the two views. Registration is automatic.
 */
export abstract class BaseActivityPlugin implements ActivityPlugin, OnModuleInit {
  abstract readonly type: string;
  abstract readonly features: PluginFeatures;
  /** Prisma delegate name for the per-type instance table (e.g. 'modPage'). */
  protected abstract readonly table: string;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  protected get org(): string {
    return this.tenant.organizationId;
  }

  /** Untyped delegate access — matches the house `tx: any` idiom for polymorphic tables. */
  protected get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  protected model(): any {
    return this.db[this.table];
  }

  abstract createInstance(ctx: PluginCtx, dto: Record<string, unknown>): Promise<{ instanceId: string }>;
  abstract updateInstance(ctx: PluginCtx, instanceId: string, dto: Record<string, unknown>): Promise<void>;
  abstract viewForStudent(ctx: PluginCtx, cm: CourseModule): Promise<unknown>;
  abstract viewForTeacher(ctx: PluginCtx, cm: CourseModule): Promise<unknown>;

  async getInstance(_ctx: PluginCtx, instanceId: string): Promise<unknown> {
    return this.model().findFirst({ where: { id: instanceId, organizationId: this.org } });
  }

  async deleteInstance(_ctx: PluginCtx, instanceId: string): Promise<void> {
    await this.model().deleteMany({ where: { id: instanceId, organizationId: this.org } });
  }

  async exportInstance(_ctx: PluginCtx, instanceId: string, _opts: { includeUserData: boolean }): Promise<unknown> {
    const row = await this.model().findFirst({ where: { id: instanceId, organizationId: this.org } });
    if (!row) return {};
    const { id, organizationId, createdAt, updatedAt, ...rest } = row;
    return rest;
  }

  async importInstance(_ctx: PluginCtx, payload: unknown): Promise<{ instanceId: string }> {
    const data = { ...(payload as Record<string, unknown>), organizationId: this.org };
    const row = await this.model().create({ data });
    return { instanceId: row.id };
  }
}
