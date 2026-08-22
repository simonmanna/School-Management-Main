import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';

/** Badges (ADR-014 §3.8 / P7) — manual or criteria-driven achievements. */
@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  list(courseOfferingId?: string) {
    return this.prisma.client.lmsBadge.findMany({
      where: { organizationId: this.org, ...(courseOfferingId ? { courseOfferingId } : {}) },
      include: { _count: { select: { awards: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: { name: string; description?: string; imageUrl?: string; criteriaType?: string; criteria?: unknown; courseOfferingId?: string }) {
    return this.prisma.client.lmsBadge.create({
      data: { organizationId: this.org, name: dto.name, description: dto.description, imageUrl: dto.imageUrl, criteriaType: dto.criteriaType ?? 'manual', criteria: (dto.criteria as any) ?? {}, courseOfferingId: dto.courseOfferingId },
    });
  }

  award(badgeId: string, dto: { studentProfileId?: string; userId?: string }) {
    // Prisma 6 requires every column of a compound-unique constraint to be present
    // and non-null in an upsert `where`; pad a null nullable FK with a sentinel for
    // the lookup key (the real value is still written in `create`).
    const NONE = '__none__';
    const whereKey = {
      badgeId,
      studentProfileId: dto.studentProfileId ?? NONE,
      userId: dto.userId ?? NONE,
    };
    return this.prisma.client.lmsBadgeAward.upsert({
      where: { badgeId_studentProfileId_userId: whereKey as any },
      create: { organizationId: this.org, badgeId, studentProfileId: dto.studentProfileId, userId: dto.userId, awardedById: this.tenant.userId },
      update: {},
    });
  }

  awardsFor(studentProfileId: string) {
    return this.prisma.client.lmsBadgeAward.findMany({ where: { organizationId: this.org, studentProfileId }, include: { badge: true } });
  }
}
