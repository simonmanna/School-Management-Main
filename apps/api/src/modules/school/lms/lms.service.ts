import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement, HomeworkAssignment, HomeworkSubmission, LearningResource } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
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
    private readonly audit: AuditService,
  ) {
    super(prisma.client.homeworkAssignment as unknown as CrudDelegate);
  }

  async create(dto: CreateHomeworkDto): Promise<HomeworkAssignment> {
    return this.prisma.client.$transaction(async (tx: any) => {
      // A0: the teacher is an explicit, validated FK — no id-from-session guess,
      // no all-zeros fallback that pointed at no StaffProfile.
      const teacher = await tx.staffProfile.findFirst({ where: { id: dto.teacherPartnerId } });
      if (!teacher) throw new NotFoundException(`Staff profile ${dto.teacherPartnerId} not found`);

      const klass = await tx.schoolClass.findFirst({ where: { id: dto.classId } });
      if (!klass) throw new NotFoundException(`Class ${dto.classId} not found`);

      const row = await tx.homeworkAssignment.create({
        data: {
          ...dto,
          dueDate: new Date(dto.dueDate),
          attachments: (dto.attachments as any) ?? [],
        } as any,
      });
      await this.audit.recordInTx(tx, {
        entity: 'HomeworkAssignment',
        entityId: row.id,
        action: 'create',
        newValues: { classId: row.classId, subjectId: row.subjectId, teacherPartnerId: row.teacherPartnerId },
      });
      this.events.publish(EVENTS.SchoolHomeworkAssigned, {
        organizationId: this.tenant.organizationId,
        assignmentId: row.id,
        classId: row.classId,
        subjectId: row.subjectId,
      });
      return row;
    });
  }

  async submit(dto: SubmitHomeworkDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      // A0: the student is validated, and must actually belong to the class the
      // assignment was set for — a submission can no longer be attributed to a
      // non-existent (or wrong-class) student.
      const assignment = await tx.homeworkAssignment.findFirst({ where: { id: dto.assignmentId } });
      if (!assignment) throw new NotFoundException(`Assignment ${dto.assignmentId} not found`);

      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student profile ${dto.studentProfileId} not found`);
      if (student.currentClassId !== assignment.classId) {
        throw new BadRequestException(
          `Student ${dto.studentProfileId} is not in the class this assignment was set for`,
        );
      }

      const sub = await tx.homeworkSubmission.upsert({
        where: {
          assignmentId_studentProfileId: {
            assignmentId: dto.assignmentId,
            studentProfileId: dto.studentProfileId,
          } as any,
        },
        create: {
          organizationId,
          assignmentId: dto.assignmentId,
          studentProfileId: dto.studentProfileId,
          submittedAt: new Date(),
          content: dto.content ?? null,
          attachments: (dto.attachments as any) ?? [],
          // Late if submitted after the due date — the derived status the CA
          // engine later reads instead of guessing from a missing row.
          status: new Date() > assignment.dueDate ? 'late' : 'submitted',
        },
        update: {
          submittedAt: new Date(),
          content: dto.content ?? null,
          attachments: (dto.attachments as any) ?? [],
          status: new Date() > assignment.dueDate ? 'late' : 'submitted',
        },
      });
      return sub;
    });
  }

  async grade(dto: GradeSubmissionDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const sub = await tx.homeworkSubmission.findFirst({ where: { id: dto.submissionId } });
      if (!sub) throw new NotFoundException(`Submission ${dto.submissionId} not found`);

      // A0: a homework score cannot exceed the assignment's maxScore.
      const assignment = await tx.homeworkAssignment.findFirst({ where: { id: sub.assignmentId } });
      const max = assignment?.maxScore != null ? Number(assignment.maxScore) : null;
      if (dto.score < 0 || (max != null && dto.score > max)) {
        throw new BadRequestException(
          `Score ${dto.score} out of range [0, ${max ?? '∞'}] for this assignment`,
        );
      }

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
      await this.audit.recordInTx(tx, {
        entity: 'HomeworkSubmission',
        entityId: dto.submissionId,
        action: 'update',
        newValues: { score: dto.score, status: 'graded', action: 'grade' },
      });
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