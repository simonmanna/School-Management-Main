import { Injectable } from '@nestjs/common';
import type { CourseModule } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';
import { BaseActivityPlugin } from './plugin-base';
import type { PluginCtx, PluginFeatures } from '../plugin.types';

const contentFeatures = (label: string, icon: string): PluginFeatures => ({
  gradable: false,
  hasSubmissions: false,
  supportsGroups: false,
  supportsCompletionAuto: true,
  completionRuleKeys: ['view'],
  label,
  icon,
});

/** mod_resource — a file/attachment resource. */
@Injectable()
export class ModResourcePlugin extends BaseActivityPlugin {
  readonly type = 'resource';
  readonly features = contentFeatures('File', 'FileText');
  protected readonly table = 'modResource';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'File', intro: dto.intro ?? null, resourceId: dto.resourceId ?? null, fileId: dto.fileId ?? null, displayMode: dto.displayMode ?? 'auto' } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, resourceId: dto.resourceId, fileId: dto.fileId, displayMode: dto.displayMode } });
  }

  /** Resolve the payload file so the card can show its name, type and size. */
  private async resolveFile(instanceId: string) {
    const inst: any = await this.model().findFirst({ where: { id: instanceId, organizationId: this.org } });
    if (!inst?.fileId) return { instance: inst, file: null };
    const file = await this.db.file.findFirst({
      where: { id: inst.fileId, organizationId: this.org, deletedAt: null },
      select: { id: true, filename: true, contentType: true, byteSize: true },
    });
    return { instance: inst, file };
  }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.resolveFile(cm.instanceId); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.resolveFile(cm.instanceId); }
}

/** mod_url — an external link. */
@Injectable()
export class ModUrlPlugin extends BaseActivityPlugin {
  readonly type = 'url';
  readonly features = contentFeatures('URL', 'Link');
  protected readonly table = 'modUrl';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Link', intro: dto.intro ?? null, externalUrl: dto.externalUrl ?? '', display: dto.display ?? 'new_window' } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, externalUrl: dto.externalUrl, display: dto.display } });
  }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }
}

/** mod_page — a rich-text page. */
@Injectable()
export class ModPagePlugin extends BaseActivityPlugin {
  readonly type = 'page';
  readonly features = contentFeatures('Page', 'File');
  protected readonly table = 'modPage';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Page', intro: dto.intro ?? null, content: dto.content ?? '', contentFormat: dto.contentFormat ?? 'html' } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, content: dto.content, contentFormat: dto.contentFormat } });
  }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }
}

/** mod_label — inline text placed directly on the course page. */
@Injectable()
export class ModLabelPlugin extends BaseActivityPlugin {
  readonly type = 'label';
  readonly features = { ...contentFeatures('Text', 'Type'), completionRuleKeys: [] as string[] };
  protected readonly table = 'modLabel';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, content: dto.content ?? '' } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { content: dto.content } });
  }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.getInstance(_ctx, cm.instanceId); }

  /**
   * A label has no title — it IS its text, rendered inline on the course page.
   * The base implementation would fall back to the generic type label ("Text"),
   * so derive something readable from the first line of content instead.
   */
  async instanceSummaries(ids: string[]) {
    if (ids.length === 0) return new Map<string, { name: string; intro?: string | null }>();
    const rows: Array<{ id: string; content: string }> =
      await this.model().findMany({ where: { id: { in: ids }, organizationId: this.org } });
    return new Map(
      rows.map((r) => {
        const text = String(r.content ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return [r.id, { name: text.slice(0, 80) || 'Text', intro: r.content ?? null }];
      }),
    );
  }
}

/** mod_folder — a set of files. */
@Injectable()
export class ModFolderPlugin extends BaseActivityPlugin {
  readonly type = 'folder';
  readonly features = contentFeatures('Folder', 'Folder');
  protected readonly table = 'modFolder';
  constructor(prisma: PrismaService, tenant: TenantContextService, registry: ActivityRegistry) { super(prisma, tenant, registry); }

  async createInstance(_ctx: PluginCtx, dto: Record<string, unknown>) {
    const row = await this.model().create({ data: { organizationId: this.org, name: dto.name ?? 'Folder', intro: dto.intro ?? null, fileIds: (dto.fileIds as string[]) ?? [] } });
    return { instanceId: row.id };
  }
  async updateInstance(_ctx: PluginCtx, id: string, dto: Record<string, unknown>) {
    await this.model().update({ where: { id }, data: { name: dto.name, intro: dto.intro, fileIds: dto.fileIds } });
  }

  /** Resolve the folder's file ids into displayable rows. */
  private async resolveFiles(instanceId: string) {
    const inst: any = await this.model().findFirst({ where: { id: instanceId, organizationId: this.org } });
    const ids: string[] = Array.isArray(inst?.fileIds) ? inst.fileIds : [];
    const files = ids.length
      ? await this.db.file.findMany({
          where: { id: { in: ids }, organizationId: this.org, deletedAt: null },
          select: { id: true, filename: true, contentType: true, byteSize: true },
        })
      : [];
    return { instance: inst, files };
  }
  async viewForStudent(_ctx: PluginCtx, cm: CourseModule) { return this.resolveFiles(cm.instanceId); }
  async viewForTeacher(_ctx: PluginCtx, cm: CourseModule) { return this.resolveFiles(cm.instanceId); }
}

export const CONTENT_PLUGINS = [ModResourcePlugin, ModUrlPlugin, ModPagePlugin, ModLabelPlugin, ModFolderPlugin];
