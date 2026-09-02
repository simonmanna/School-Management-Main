import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CourseModule, CourseOffering, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { MarkingService } from '../../../assessment/marking.service';
import type { GradeDefinition } from '../plugin.types';

type Tx = Prisma.TransactionClient;

/**
 * The grade bridge (ADR-014 §3.5). Keeps marks in the assessment spine as the single
 * truth: a gradable CourseModule owns exactly one Assessment (sourceType=lms_activity,
 * sourceRef=courseModuleId), and plugins record marks only through here — never on
 * their own instance rows.
 */
@Injectable()
export class LmsGradeBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly marking: MarkingService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * Idempotently create the Assessment for a gradable module; returns its id.
   *
   * `tx` is required. It used to be optional and no production caller passed
   * one, so a crash mid-way left a module with an assessment nobody was fanned
   * into — which is the shape that produced every bug in this file.
   */
  async ensureAssessment(cm: CourseModule, offering: CourseOffering, grade: GradeDefinition, tx: Tx): Promise<string> {
    const db = tx;
    const existing = await db.assessment.findFirst({
      where: { organizationId: this.org, sourceType: 'lms_activity', sourceRef: cm.id },
    });
    if (existing) {
      if (Number(existing.maxScore) !== grade.maxScore) {
        // Percentages are derived against StudentAssessment.maxScore, not the
        // assessment's. Rescaling after marks exist would silently restate every
        // student's percentage against a maximum they were never marked out of.
        const marked = await db.markEntry.count({
          where: { studentAssessment: { assessmentId: existing.id } },
        });
        if (marked > 0) {
          throw new BadRequestException(
            `Cannot change the maximum score of "${existing.title}" to ${grade.maxScore}: ${marked} mark(s) ` +
              'have already been recorded against the current maximum.',
          );
        }
        await db.assessment.update({ where: { id: existing.id }, data: { maxScore: grade.maxScore } });
        // Cascade to the fanned-out rows, or recompute reads a stale maximum.
        await db.studentAssessment.updateMany({
          where: { assessmentId: existing.id },
          data: { maxScore: grade.maxScore },
        });
      }
      return existing.id;
    }
    if (!offering.subjectId || !offering.classId) {
      throw new BadRequestException('Only subject/class offerings can create numerical LMS assessments.');
    }
    const created = await db.assessment.create({
      data: {
        organizationId: this.org,
        subjectId: offering.subjectId,
        classId: offering.classId,
        termId: offering.termId,
        title: `[LMS] ${cm.id.slice(0, 8)}`,
        maxScore: grade.maxScore,
        // Work done inside a course is classwork. Leaving `kind` null sent it
        // to the read-time guess, which called it a CAT and weighted it against
        // the CAT component — the single biggest way LMS activity distorted a
        // subject's term mark.
        kind: 'classwork',
        sourceType: 'lms_activity',
        sourceRef: cm.id,
        status: 'draft',
        createdBy: this.tenant.userId ?? null,
      },
    });
    await db.courseModule.update({ where: { id: cm.id }, data: { assessmentId: created.id } });
    return created.id;
  }

  /** Fan the enrolled roster into StudentAssessment rows (idempotent via the unique key). */
  async fanout(assessmentId: string, cm: CourseModule, tx: Tx): Promise<number> {
    const db = tx;
    const assessment = await db.assessment.findFirst({ where: { id: assessmentId, organizationId: this.org } });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);

    const enrolments = await db.courseEnrolment.findMany({
      where: { organizationId: this.org, courseOfferingId: cm.courseOfferingId, status: 'active', studentProfileId: { not: null } },
      select: { studentProfileId: true },
    });
    let n = 0;
    for (const e of enrolments) {
      if (!e.studentProfileId) continue;
      await db.studentAssessment.upsert({
        where: { assessmentId_studentProfileId: { assessmentId, studentProfileId: e.studentProfileId } },
        create: {
          organizationId: this.org,
          assessmentId,
          studentProfileId: e.studentProfileId,
          classId: assessment.classId,
          termId: assessment.termId,
          maxScore: assessment.maxScore,
        },
        update: {},
      });
      n++;
    }
    return n;
  }

  /**
   * Record a mark for one student, through the spine, with history. Refuses if
   * the item is locked.
   *
   * This used to write `effectiveScore` straight onto the StudentAssessment. A
   * row with a score but no MarkEntry behind it is blanked by the next
   * `recompute`, because the derived columns are computed from the ledger and
   * an empty ledger means "no mark". Delegating to `postMark` puts the score in
   * the ledger where it belongs; clamping is preserved via `onOutOfRange`.
   */
  async setScore(input: { studentAssessmentId: string; score: number; source: string }, tx: Tx): Promise<void> {
    await this.marking.postMark(tx, {
      studentAssessmentId: input.studentAssessmentId,
      score: input.score,
      source: 'lms',
      comment: input.source,
      onOutOfRange: 'clamp',
    });
  }

  /** Manual override with a reason (Moodle grade override). */
  async override(input: { studentAssessmentId: string; score: number; reason?: string }): Promise<void> {
    const userId = this.tenant.userId;
    if (!userId) throw new BadRequestException('Override requires an authenticated user');
    await this.prisma.client.$transaction(async (tx: Tx) => {
      await tx.assessmentGradeOverride.upsert({
        where: { studentAssessmentId: input.studentAssessmentId },
        create: {
          organizationId: this.org,
          studentAssessmentId: input.studentAssessmentId,
          overriddenScore: input.score,
          reason: input.reason,
          overriddenById: userId,
        },
        update: { overriddenScore: input.score, reason: input.reason, overriddenById: userId },
      });
      await this.setScore({ studentAssessmentId: input.studentAssessmentId, score: input.score, source: 'override' }, tx);
    });
  }

  /** Hide / show a grade item from students. */
  async setHidden(assessmentId: string, hidden: boolean): Promise<void> {
    await this.prisma.client.assessment.updateMany({
      where: { id: assessmentId, organizationId: this.org },
      data: { hiddenFromStudents: hidden },
    });
  }

  /** Lock / unlock a grade item. */
  async setLocked(assessmentId: string, locked: boolean): Promise<void> {
    await this.prisma.client.assessment.updateMany({
      where: { id: assessmentId, organizationId: this.org },
      data: { lockedAt: locked ? new Date() : null },
    });
  }
}
