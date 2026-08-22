import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsContextService } from '../context/context.service';

/**
 * Question bank (ADR-014 §3.6). Categories form a tree OWNED BY A CONTEXT — a
 * course-level bank is invisible to other courses; an org-level bank is shared.
 * Question versioning snapshots a question so live attempts keep their variant.
 */
@Injectable()
export class QuestionBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly contexts: LmsContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Categories owned by a course context (default) or the org context. */
  async listCategories(opts: { courseOfferingId?: string }) {
    const ctx = opts.courseOfferingId
      ? await this.contexts.ensureCourseContext(opts.courseOfferingId)
      : await this.contexts.ensureOrgContext();
    return this.prisma.client.questionCategory.findMany({ where: { organizationId: this.org, contextId: ctx.id }, orderBy: { sortOrder: 'asc' } });
  }

  async createCategory(dto: { name: string; info?: string; parentId?: string; courseOfferingId?: string }) {
    const ctx = dto.courseOfferingId ? await this.contexts.ensureCourseContext(dto.courseOfferingId) : await this.contexts.ensureOrgContext();
    let path = '/';
    let depth = 0;
    if (dto.parentId) {
      const parent = await this.prisma.client.questionCategory.findFirst({ where: { id: dto.parentId, organizationId: this.org } });
      if (!parent) throw new NotFoundException('Parent category not found');
      path = parent.path;
      depth = 0; // path finalized below
    }
    const created = await this.prisma.client.questionCategory.create({
      data: { organizationId: this.org, contextId: ctx.id, parentId: dto.parentId, name: dto.name, info: dto.info, path: '', sortOrder: 0 },
    });
    const finalPath = `${path}${created.id}/`;
    void depth;
    return this.prisma.client.questionCategory.update({ where: { id: created.id }, data: { path: finalPath } });
  }

  /** Snapshot the current state of a Question as a new immutable version. */
  async versionQuestion(questionId: string, snapshot: unknown) {
    const max = await this.prisma.client.questionVersion.aggregate({ where: { questionId }, _max: { version: true } });
    return this.prisma.client.questionVersion.create({
      data: { questionId, version: (max._max.version ?? 0) + 1, status: 'ready', snapshot: snapshot as any },
    });
  }

  listVersions(questionId: string) {
    return this.prisma.client.questionVersion.findMany({ where: { questionId }, orderBy: { version: 'desc' } });
  }
}
