import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';

/** Groups & groupings (ADR-014 §3.3) — separate-groups forums, group assignments, differentiated release. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  listGroups(courseOfferingId: string) {
    return this.prisma.client.lmsGroup.findMany({
      where: { organizationId: this.org, courseOfferingId },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createGroup(courseOfferingId: string, dto: { name: string; description?: string; enrolmentKey?: string }) {
    return this.prisma.client.lmsGroup.create({
      data: { organizationId: this.org, courseOfferingId, name: dto.name, description: dto.description, enrolmentKey: dto.enrolmentKey },
    });
  }

  async addMember(groupId: string, dto: { studentProfileId?: string; userId?: string }) {
    const group = await this.prisma.client.lmsGroup.findFirst({ where: { id: groupId, organizationId: this.org } });
    if (!group) throw new NotFoundException('Group not found');
    // Prisma 6 requires every column of a compound-unique constraint to be present
    // and non-null in an upsert `where`; pad a null nullable FK with a sentinel for
    // the lookup key (the real value is still written in `create`).
    const NONE = '__none__';
    const whereKey = {
      groupId,
      studentProfileId: dto.studentProfileId ?? NONE,
      userId: dto.userId ?? NONE,
    };
    return this.prisma.client.lmsGroupMember.upsert({
      where: { groupId_studentProfileId_userId: whereKey as any },
      create: { groupId, studentProfileId: dto.studentProfileId, userId: dto.userId },
      update: {},
    });
  }

  async removeMember(memberId: string) {
    await this.prisma.client.lmsGroupMember.delete({ where: { id: memberId } });
    return { ok: true };
  }

  members(groupId: string) {
    return this.prisma.client.lmsGroupMember.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' } });
  }

  listGroupings(courseOfferingId: string) {
    return this.prisma.client.lmsGrouping.findMany({ where: { organizationId: this.org, courseOfferingId }, orderBy: { name: 'asc' } });
  }

  createGrouping(courseOfferingId: string, dto: { name: string; groupIds?: string[] }) {
    return this.prisma.client.lmsGrouping.create({
      data: { organizationId: this.org, courseOfferingId, name: dto.name, groupIds: dto.groupIds ?? [] },
    });
  }
}
