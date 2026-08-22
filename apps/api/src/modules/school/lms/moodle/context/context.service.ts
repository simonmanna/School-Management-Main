import { Injectable, NotFoundException } from '@nestjs/common';
import type { LmsContext, LmsContextLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';

type Db = PrismaService['client'] | Prisma.TransactionClient;

/**
 * The LMS context tree (ADR-014 §3.1). A materialised-path forest rooted at the
 * organization context. Every course, activity and category owns exactly one
 * context; roles are assigned AT a context and inherited DOWN the path.
 */
@Injectable()
export class LmsContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** The org-root context, created on first use. Parent of every category/course context. */
  async ensureOrgContext(db: Db = this.prisma.client): Promise<LmsContext> {
    return this.ensure(db, 'organization', this.org, null);
  }

  async ensureCourseContext(courseOfferingId: string, db: Db = this.prisma.client): Promise<LmsContext> {
    const parent = await this.ensureOrgContext(db);
    return this.ensure(db, 'course', courseOfferingId, parent);
  }

  async ensureActivityContext(courseModuleId: string, courseOfferingId: string, db: Db = this.prisma.client): Promise<LmsContext> {
    const parent = await this.ensureCourseContext(courseOfferingId, db);
    return this.ensure(db, 'activity', courseModuleId, parent);
  }

  async ensureCategoryContext(categoryId: string, db: Db = this.prisma.client): Promise<LmsContext> {
    const parent = await this.ensureOrgContext(db);
    return this.ensure(db, 'category', categoryId, parent);
  }

  /** Idempotent get-or-create for one context node. */
  private async ensure(
    db: Db,
    level: LmsContextLevel,
    instanceId: string | null,
    parent: LmsContext | null,
  ): Promise<LmsContext> {
    const existing = await db.lmsContext.findFirst({
      where: { organizationId: this.org, level, instanceId },
    });
    if (existing) return existing;

    // path is built once at insert; a context never moves parents in this design.
    const created = await db.lmsContext.create({
      data: {
        organizationId: this.org,
        level,
        instanceId,
        parentId: parent?.id ?? null,
        path: '', // filled below once we have the id
        depth: parent ? parent.depth + 1 : 0,
      },
    });
    const path = `${parent?.path ?? '/'}${created.id}/`;
    return db.lmsContext.update({ where: { id: created.id }, data: { path } });
  }

  async byId(contextId: string): Promise<LmsContext> {
    const ctx = await this.prisma.client.lmsContext.findFirst({
      where: { id: contextId, organizationId: this.org },
    });
    if (!ctx) throw new NotFoundException(`LmsContext ${contextId} not found`);
    return ctx;
  }

  /** Ancestor context ids for a path, org-root first, self last. */
  ancestorIds(ctx: Pick<LmsContext, 'path'>): string[] {
    return ctx.path.split('/').filter(Boolean);
  }

  /** Resolve the course context for a course, without creating (read path). */
  async findCourseContext(courseOfferingId: string): Promise<LmsContext | null> {
    return this.prisma.client.lmsContext.findFirst({
      where: { organizationId: this.org, level: 'course', instanceId: courseOfferingId },
    });
  }
}
