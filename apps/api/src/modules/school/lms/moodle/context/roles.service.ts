import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { LmsRole } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsContextService } from './context.service';
import { CapabilityService } from './capability.service';
import { ROLE_ARCHETYPES } from './roles.seed';

/** Seeds archetype roles and assigns/removes roles at a context (ADR-014 §3.1). */
@Injectable()
export class LmsRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly contexts: LmsContextService,
    private readonly caps: CapabilityService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Idempotently create the 8 archetype roles and their default capabilities for this org. */
  async seed(): Promise<{ seeded: number }> {
    let n = 0;
    for (const def of ROLE_ARCHETYPES) {
      const role = await this.prisma.client.lmsRole.upsert({
        where: { organizationId_shortname: { organizationId: this.org, shortname: def.shortname } },
        create: {
          organizationId: this.org,
          shortname: def.shortname,
          name: def.name,
          archetype: def.archetype,
          sortOrder: def.sortOrder,
          assignableAt: def.assignableAt,
        },
        update: { name: def.name, archetype: def.archetype, sortOrder: def.sortOrder, assignableAt: def.assignableAt },
      });
      for (const cap of def.allow) {
        await this.prisma.client.lmsRoleCapability.upsert({
          where: { roleId_capability: { roleId: role.id, capability: cap } },
          create: { roleId: role.id, capability: cap, permission: 'allow' },
          update: { permission: 'allow' },
        });
      }
      n++;
    }
    this.caps.bust();
    return { seeded: n };
  }

  async listRoles(): Promise<LmsRole[]> {
    return this.prisma.client.lmsRole.findMany({ where: { organizationId: this.org }, orderBy: { sortOrder: 'asc' } });
  }

  private async roleByShortname(shortname: string): Promise<LmsRole> {
    const role = await this.prisma.client.lmsRole.findFirst({ where: { organizationId: this.org, shortname } });
    if (!role) throw new NotFoundException(`Role '${shortname}' not found — seed roles first.`);
    return role;
  }

  /** Assign a role to a principal at a course context (the common case). */
  async assignAtCourse(dto: {
    courseOfferingId: string;
    roleShortname: string;
    userId?: string;
    studentProfileId?: string;
    sourceComponent?: string;
  }) {
    if (!dto.userId && !dto.studentProfileId) throw new BadRequestException('userId or studentProfileId required');
    const role = await this.roleByShortname(dto.roleShortname);
    const ctx = await this.contexts.ensureCourseContext(dto.courseOfferingId);
    // Prisma 6 requires every column of a compound-unique constraint to be present
    // and non-null in the `where` of an upsert — it rejects both `null` AND a missing
    // key. So pad a null nullable FK with a sentinel for the lookup key (the real,
    // possibly-null value is still written in `create`/`update`).
    const NONE = '__none__';
    const whereKey = {
      contextId: ctx.id,
      roleId: role.id,
      userId: dto.userId ?? NONE,
      studentProfileId: dto.studentProfileId ?? NONE,
    };
    const assignment = await this.prisma.client.lmsRoleAssignment.upsert({
      where: { contextId_roleId_userId_studentProfileId: whereKey as any },
      create: {
        organizationId: this.org,
        contextId: ctx.id,
        roleId: role.id,
        userId: dto.userId,
        studentProfileId: dto.studentProfileId,
        sourceComponent: dto.sourceComponent ?? 'manual',
      },
      update: { sourceComponent: dto.sourceComponent ?? 'manual' },
    });
    this.caps.bust();
    return assignment;
  }

  async unassign(assignmentId: string) {
    const existing = await this.prisma.client.lmsRoleAssignment.findFirst({
      where: { id: assignmentId, organizationId: this.org },
    });
    if (!existing) throw new NotFoundException('Assignment not found');
    await this.prisma.client.lmsRoleAssignment.delete({ where: { id: assignmentId } });
    this.caps.bust();
    return { ok: true };
  }

  /** All role assignments at a course context, with role info — drives the participants screen. */
  async participants(courseOfferingId: string) {
    const ctx = await this.contexts.findCourseContext(courseOfferingId);
    if (!ctx) return [];
    return this.prisma.client.lmsRoleAssignment.findMany({
      where: { organizationId: this.org, contextId: ctx.id },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
