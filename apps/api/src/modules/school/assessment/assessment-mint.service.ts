import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * AssessmentMintService — the one place an `Assessment` is created on behalf of
 * something else that owns the work (an exam paper, a piece of homework).
 *
 * Every producer used to mint its own, and they disagreed about when. The exam
 * projection minted on the first mark, so a paper the office had applied showed
 * no gradebook column until somebody typed into it. `gradeHomework` minted on
 * the first grade, so homework that had been set but not yet marked was
 * invisible to the gradebook — and, because it looked the row up by
 * `(sourceType, sourceRef)` rather than by a link on the homework, a second
 * Assessment could appear behind the first.
 *
 * Minting happens when the WORK IS CREATED, not when it is first marked. The
 * column exists from the moment the paper is applied or the homework is set,
 * which is what a teacher expects to see.
 *
 * Every method is idempotent and takes the caller's transaction, so the origin
 * row and its assessment are written atomically or not at all.
 */
@Injectable()
export class AssessmentMintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * The gradebook column for one exam paper. Attaches to whatever weighting
   * component is bridged to the exam's `ExamType`, if a school configured one;
   * an unattached assessment still records marks, it just lands in the
   * "not in the weighting policy" group until a policy claims it.
   */
  async forExamSchedule(tx: any, examScheduleId: string): Promise<any | null> {
    const schedule = await tx.examSchedule.findFirst({
      where: { id: examScheduleId },
      include: { exam: true, subject: true },
    });
    if (!schedule) return null;

    const existing = await tx.assessment.findFirst({
      where: { organizationId: this.org, sourceType: 'exam_session', sourceRef: schedule.id },
    });
    if (existing) return existing;

    const component = schedule.exam.examTypeId
      ? await tx.assessmentComponent.findFirst({ where: { examTypeId: schedule.exam.examTypeId } })
      : null;

    return tx.assessment.create({
      data: {
        organizationId: this.org,
        componentId: component?.id ?? null,
        subjectId: schedule.subjectId,
        classId: schedule.classId,
        termId: schedule.exam.termId,
        title: `${schedule.subject?.name ?? 'Exam'} — ${schedule.exam.name}`,
        maxScore: schedule.maxMarks,
        kind: 'exam',
        sequence: schedule.paperNumber ?? 1,
        isResit: schedule.isResit ?? false,
        sourceType: 'exam_session',
        sourceRef: schedule.id,
        status: 'grading',
        lockedAt: schedule.marksLockedAt ?? null,
        lockedById: schedule.marksLockedById ?? null,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  /** Mint one assessment per paper for a batch of schedules, idempotently. */
  async forExamSchedules(tx: any, examScheduleIds: string[]): Promise<number> {
    let minted = 0;
    for (const id of examScheduleIds) {
      const before = await tx.assessment.findFirst({
        where: { organizationId: this.org, sourceType: 'exam_session', sourceRef: id },
        select: { id: true },
      });
      if (before) continue;
      if (await this.forExamSchedule(tx, id)) minted += 1;
    }
    return minted;
  }

  /**
   * The gradebook column for one homework.
   *
   * `Assessment.termId` is NOT NULL, and homework's term is optional. This used
   * to be discovered at GRADING time — the worst possible moment to tell a
   * teacher their marks have nowhere to go — so the term is resolved here, when
   * the homework is created, and only refused if nothing can resolve it.
   */
  async forHomework(tx: any, homework: any): Promise<any> {
    if (homework.assessmentId) {
      const linked = await tx.assessment.findFirst({ where: { id: homework.assessmentId } });
      if (linked) return linked;
    }

    // Compat for rows that predate the link: adopt the assessment the old
    // grade-time upsert would have created rather than minting a duplicate.
    const legacy = await tx.assessment.findFirst({
      where: {
        organizationId: this.org,
        sourceType: { in: ['homework', 'assignment'] },
        sourceRef: homework.id,
      },
    });
    if (legacy) {
      await tx.homeworkAssignment.updateMany({ where: { id: homework.id }, data: { assessmentId: legacy.id } });
      return legacy;
    }

    const termId = homework.termId ?? (await this.resolveTerm(tx, homework.dueDate));
    if (!termId) {
      throw new BadRequestException(
        `Homework "${homework.title}" falls in no term, so its marks would have nowhere to go in the gradebook. ` +
          `Set a term on the homework, or create the term that covers ${new Date(homework.dueDate).toDateString()}.`,
      );
    }

    const component = await tx.assessmentComponent.findFirst({
      where: { organizationId: this.org, kind: 'homework' },
    });

    const created = await tx.assessment.create({
      data: {
        organizationId: this.org,
        componentId: component?.id ?? null,
        subjectId: homework.subjectId,
        classId: homework.classId,
        sectionId: homework.sectionId ?? null,
        termId,
        teacherPartnerId: homework.teacherPartnerId ?? null,
        title: homework.title,
        maxScore: homework.maxScore ?? 100,
        kind: 'homework',
        sourceType: 'homework',
        sourceRef: homework.id,
        status: 'published',
        dueAt: homework.dueDate ?? null,
        createdBy: this.tenant.userId ?? null,
      },
    });
    await tx.homeworkAssignment.updateMany({ where: { id: homework.id }, data: { assessmentId: created.id } });
    return created;
  }

  /** The term containing a date, else the one the school marked current. */
  private async resolveTerm(tx: any, on?: Date | string | null): Promise<string | null> {
    if (on) {
      const at = new Date(on);
      const covering = await tx.term.findFirst({
        where: { organizationId: this.org, startDate: { lte: at }, endDate: { gte: at }, deletedAt: null },
        select: { id: true },
      });
      if (covering) return covering.id;
    }
    const current = await tx.term.findFirst({
      where: { organizationId: this.org, isCurrent: true, deletedAt: null },
      select: { id: true },
    });
    return current?.id ?? null;
  }
}
