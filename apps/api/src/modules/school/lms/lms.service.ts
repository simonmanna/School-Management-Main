import { Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement, HomeworkAssignment, HomeworkSubmission, LearningResource } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type {
  CreateAnnouncementDto,
  CreateHomeworkDto,
  CreateLearningResourceDto,
  GradeSubmissionDto,
  SubmitHomeworkDto,
  UpdateAnnouncementDto,
  UpdateHomeworkDto,
  UpdateLearningResourceDto,
} from './dto.types';

@Injectable()
export class HomeworkService extends BaseCrudService<HomeworkAssignment, CreateHomeworkDto, UpdateHomeworkDto> {
  protected readonly entityName = 'HomeworkAssignment';
  protected readonly searchFields = ['title', 'description'];
  protected readonly defaultInclude = { subject: true, schoolClass: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.homeworkAssignment as unknown as CrudDelegate);
  }

  async create(dto: CreateHomeworkDto): Promise<HomeworkAssignment> {
    const teacherPartnerId = this.tenant.userId;
    // Default to the logged-in user as the teacher if not provided.
    const row = await this.prisma.client.homeworkAssignment.create({
      data: {
        ...dto,
        teacherPartnerId: teacherPartnerId ?? '00000000-0000-0000-0000-000000000000',
        dueDate: new Date(dto.dueDate),
        attachments: (dto.attachments as any) ?? [],
      } as any,
    });
    this.events.publish(EVENTS.SchoolHomeworkAssigned, {
      organizationId: this.tenant.organizationId,
      assignmentId: row.id,
      classId: row.classId,
      subjectId: row.subjectId,
    });
    return row;
  }

  async submit(dto: SubmitHomeworkDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const studentProfileId = this.tenant.userId; // In a real portal the user→student map would resolve this.
      const sub = await tx.homeworkSubmission.upsert({
        where: {
          assignmentId_studentProfileId: {
            assignmentId: dto.assignmentId,
            studentProfileId: studentProfileId ?? '',
          } as any,
        },
        create: {
          organizationId,
          assignmentId: dto.assignmentId,
          studentProfileId: studentProfileId ?? '',
          submittedAt: new Date(),
          content: dto.content ?? null,
          attachments: (dto.attachments as any) ?? [],
          status: 'submitted',
        },
        update: {
          submittedAt: new Date(),
          content: dto.content ?? null,
          attachments: (dto.attachments as any) ?? [],
          status: 'submitted',
        },
      });
      return sub;
    });
  }

  async grade(dto: GradeSubmissionDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const sub = await tx.homeworkSubmission.findFirst({ where: { id: dto.submissionId } });
      if (!sub) throw new NotFoundException(`Submission ${dto.submissionId} not found`);
      const updated = await tx.homeworkSubmission.updateMany({
        where: { id: dto.submissionId },
        data: {
          score: dto.score,
          feedback: dto.feedback ?? null,
          gradedById: this.tenant.userId ?? null,
          gradedAt: new Date(),
          status: 'graded',
        },
      });
      if (updated.count === 0) throw new NotFoundException(`Submission ${dto.submissionId} not found`);
      this.events.publish(EVENTS.SchoolHomeworkGraded, {
        organizationId: this.tenant.organizationId,
        submissionId: dto.submissionId,
        assignmentId: sub.assignmentId,
        studentProfileId: sub.studentProfileId,
      });
      return tx.homeworkSubmission.findFirst({ where: { id: dto.submissionId } });
    });
  }

  async byClass(classId: string) {
    return this.prisma.client.homeworkAssignment.findMany({
      where: { classId },
      include: { subject: true, submissions: true },
      orderBy: { dueDate: 'desc' },
    });
  }
}

@Injectable()
export class SubmissionService extends BaseCrudService<HomeworkSubmission, SubmitHomeworkDto, never> {
  protected readonly entityName = 'HomeworkSubmission';
  protected readonly searchFields: string[] = [];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.homeworkSubmission as unknown as CrudDelegate);
  }
}

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