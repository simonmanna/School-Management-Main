import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement, HomeworkAssignment, HomeworkSubmission, LearningResource } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import { LmsExecutionService } from './lms-execution.service';
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
    private readonly execution: LmsExecutionService,
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

  /**
   * Grade a homework submission.
   *
   * This used to write the score onto `HomeworkSubmission` and stop there — no
   * spine row, so nothing downstream could see it. A teacher marking homework
   * here produced a number that appeared on no gradebook and no report card.
   * It now delegates to the execution service's bridge, which posts the mark
   * into the assessment spine through the marking ledger and writes the same
   * submission fields. The event and audit trail are preserved.
   */
  async grade(dto: GradeSubmissionDto) {
    const sub = await this.prisma.client.homeworkSubmission.findFirst({ where: { id: dto.submissionId } });
    if (!sub) throw new NotFoundException(`Submission ${dto.submissionId} not found`);

    const graded = await this.execution.gradeHomework({
      submissionId: dto.submissionId,
      score: dto.score,
      feedback: dto.feedback,
      gradedById: this.tenant.userId ?? undefined,
    });

    await this.audit.record({
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
    return graded;
  }

  async byClass(classId: string) {
    return this.prisma.client.homeworkAssignment.findMany({
      where: { classId },
      include: { subject: true, submissions: true },
      orderBy: { dueDate: 'desc' },
    });
  }

  /**
   * One homework with a roster-derived submission list: EVERY active student in
   * the class, each with their submission if one exists. Mirrors the marksheet
   * rule — a student who has not submitted must still be visible, or the teacher
   * cannot mark or chase them.
   */
  async detail(id: string) {
    const hw = await this.prisma.client.homeworkAssignment.findFirst({
      where: { id },
      include: { subject: true, schoolClass: true },
    });
    if (!hw) throw new NotFoundException(`Homework ${id} not found`);

    const [students, submissions] = await Promise.all([
      this.prisma.client.studentProfile.findMany({
        where: { currentClassId: hw.classId, status: 'active', ...(hw.sectionId ? { currentSectionId: hw.sectionId } : {}) },
        include: { partner: true },
      }),
      this.prisma.client.homeworkSubmission.findMany({ where: { assignmentId: id } }),
    ]);
    const byStudent = new Map(submissions.map((s) => [s.studentProfileId, s]));

    const rows = students
      .map((st) => {
        const sub = byStudent.get(st.id);
        return {
          studentProfileId: st.id,
          name: st.partner?.name ?? st.admissionNo,
          admissionNo: st.admissionNo,
          submissionId: sub?.id ?? null,
          submittedAt: sub?.submittedAt ?? null,
          content: sub?.content ?? null,
          score: sub?.score != null ? Number(sub.score) : null,
          feedback: sub?.feedback ?? null,
          status: sub?.status ?? 'not_submitted',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const submitted = rows.filter((r) => r.status !== 'not_submitted').length;
    const graded = rows.filter((r) => r.status === 'graded').length;
    return {
      homework: {
        id: hw.id, title: hw.title, description: hw.description,
        dueDate: hw.dueDate, maxScore: hw.maxScore != null ? Number(hw.maxScore) : null,
        subject: hw.subject?.name ?? '', className: hw.schoolClass?.name ?? '',
        classId: hw.classId, subjectId: hw.subjectId, termId: hw.termId,
      },
      students: rows,
      total: rows.length,
      submitted,
      graded,
    };
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