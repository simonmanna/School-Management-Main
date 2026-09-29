import { Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement, LearningResource } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateAnnouncementDto,
  CreateLearningResourceDto,
  UpdateAnnouncementDto,
  UpdateLearningResourceDto,
} from './dto.types';

@Injectable()
export class LearningResourceService extends BaseCrudService<LearningResource, CreateLearningResourceDto, UpdateLearningResourceDto> {
  protected readonly entityName = 'LearningResource';
  protected readonly searchFields = ['title', 'description'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.learningResource as unknown as CrudDelegate);
  }
}

@Injectable()
export class AnnouncementService extends BaseCrudService<Announcement, CreateAnnouncementDto, UpdateAnnouncementDto> {
  protected readonly entityName = 'Announcement';
  protected readonly searchFields = ['title', 'body'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.announcement as unknown as CrudDelegate);
  }

  /** Announcements visible to a given student (school-wide + their class). */
  async forAudience(audience: 'all' | 'parents' | 'students' | 'staff', classId?: string) {
    return this.prisma.client.announcement.findMany({
      where: {
        audience: { has: audience },
        OR: [{ scope: 'school' }, ...(classId ? [{ classId }] : [])],
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async publish(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.announcement.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Announcement ${id} not found`);
      await tx.announcement.updateMany({ where: { id }, data: { publishedAt: new Date() } });
      const after = await tx.announcement.findFirst({ where: { id } });
      this.events.publish(EVENTS.SchoolAnnouncementPublished, {
        organizationId: this.tenant.organizationId,
        announcementId: id,
        scope: before.scope,
        classId: before.classId ?? undefined,
      });
      return after;
    });
  }
}