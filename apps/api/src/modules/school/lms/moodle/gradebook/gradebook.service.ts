import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsGradeBridgeService } from '../grade/grade-bridge.service';
import { GradebookService as SchoolGradebookService } from '../../../assessment/gradebook.service';
import { ViewEnvelopeService } from '../course/view-envelope.service';

type Tx = Prisma.TransactionClient;

/**
 * Gradebook (ADR-014 §3.5, §5) — read/write VIEWS over the assessment spine. No marks
 * live here; edits route through the grade bridge so the spine stays the single truth.
 */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly grades: LmsGradeBridgeService,
    private readonly gradebook: SchoolGradebookService,
    private readonly envelope: ViewEnvelopeService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Grader report: gradable modules × enrolled students, with scores. */
  async graderReport(courseOfferingId: string) {
    const offering = await this.prisma.client.courseOffering.findFirst({
      where: { id: courseOfferingId, organizationId: this.org },
      select: { classId: true, termId: true, subjectId: true },
    });
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null, assessmentId: { not: null } },
      select: { id: true, activityType: true, assessmentId: true, dueAt: true },
    });
    const assessmentIds = modules.map((m) => m.assessmentId!).filter(Boolean);
    const [assessments, rows] = await Promise.all([
      this.prisma.client.assessment.findMany({ where: { id: { in: assessmentIds } }, select: { id: true, title: true, maxScore: true, hiddenFromStudents: true, lockedAt: true } }),
      this.prisma.client.studentAssessment.findMany({
        // `assessment: { deletedAt: null }` rather than the raw module id list —
        // a soft-deleted assessment leaves its StudentAssessment rows live, so
        // filtering by id alone keeps a deleted column in the course total.
        where: { organizationId: this.org, assessmentId: { in: assessmentIds }, assessment: { deletedAt: null } },
        select: { id: true, assessmentId: true, studentProfileId: true, effectiveScore: true, percentage: true, status: true },
      }),
    ]);
    const items = modules.map((m) => ({ ...m, assessment: assessments.find((a) => a.id === m.assessmentId) }));

    // The course total is the SAME weighted subject total the school gradebook
    // and the report card show. This used to be an unweighted mean of the LMS
    // activity percentages — a second, disagreeing formula. `computeSubject` is
    // now the only one, so a student reads one number everywhere.
    const totals = offering?.classId && offering.subjectId
      ? await this.gradebook
          .sheet({ classId: offering.classId, termId: offering.termId, subjectId: offering.subjectId })
          .then((sheet) => new Map(sheet.students.map((st) => [st.studentProfileId, st.finalPercent])))
          .catch(() => new Map<string, number | null>())
      : new Map<string, number | null>();

    const byStudent = new Map<string, { studentProfileId: string; cells: Record<string, { studentAssessmentId: string; score: number | null; pct: number | null }> ; total: number | null }>();
    for (const r of rows) {
      const s = byStudent.get(r.studentProfileId) ?? { studentProfileId: r.studentProfileId, cells: {}, total: null };
      s.cells[r.assessmentId] = { studentAssessmentId: r.id, score: r.effectiveScore != null ? Number(r.effectiveScore) : null, pct: r.percentage != null ? Number(r.percentage) : null };
      byStudent.set(r.studentProfileId, s);
    }
    for (const s of byStudent.values()) {
      s.total = totals.get(s.studentProfileId) ?? null;
    }
    // Names, so the grader report reads as a class list rather than a column of
    // uuid fragments. Sorted by name for the same reason.
    const names = await this.envelope.studentNames(Array.from(byStudent.keys()));
    const students = Array.from(byStudent.values())
      .map((s) => ({
        ...s,
        studentName: names.get(s.studentProfileId)?.name ?? 'Unknown student',
        admissionNo: names.get(s.studentProfileId)?.admissionNo ?? null,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
    return { items, students };
  }

  /** One student's report — used by student and parent views. Hidden items are dropped. */
  async userReport(courseOfferingId: string, studentProfileId: string, opts: { includeHidden: boolean }) {
    const modules = await this.prisma.client.courseModule.findMany({
      where: { organizationId: this.org, courseOfferingId, deletedAt: null, assessmentId: { not: null } },
      select: { id: true, activityType: true, assessmentId: true },
    });
    const assessmentIds = modules.map((m) => m.assessmentId!).filter(Boolean);
    const assessments = await this.prisma.client.assessment.findMany({ where: { id: { in: assessmentIds } } });
    const visible = opts.includeHidden ? assessments : assessments.filter((a) => !a.hiddenFromStudents);
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { organizationId: this.org, studentProfileId, assessmentId: { in: visible.map((a) => a.id) } },
    });
    return {
      grades: visible.map((a) => {
        const r = rows.find((x) => x.assessmentId === a.id);
        // A mark reaches a learner only once moderation has APPROVED it. This is
        // the endpoint students and parents read directly, so an entered-but-
        // unapproved score must not appear here — a head of department may still
        // change it. `released: false` lets the UI say "not released yet" rather
        // than render a blank that reads as a zero.
        const released = r?.approvalStatus === 'approved' && !!a.marksReleaseAt && a.marksReleaseAt <= new Date();
        return {
          assessmentId: a.id,
          title: a.title,
          maxScore: Number(a.maxScore),
          score: released && r?.effectiveScore != null ? Number(r.effectiveScore) : null,
          percentage: released && r?.percentage != null ? Number(r.percentage) : null,
          submissionStatus: r?.status ?? null,
          released,
        };
      }),
    };
  }

  async editCell(dto: { studentAssessmentId: string; score: number }) {
    await this.prisma.client.$transaction(async (tx: Tx) => {
      await this.grades.setScore({ studentAssessmentId: dto.studentAssessmentId, score: dto.score, source: 'manual' }, tx);
    });
    return { ok: true };
  }

  override(dto: { studentAssessmentId: string; score: number; reason?: string }) {
    return this.grades.override(dto);
  }

  setHidden(assessmentId: string, hidden: boolean) {
    return this.grades.setHidden(assessmentId, hidden);
  }
  setLocked(assessmentId: string, locked: boolean) {
    return this.grades.setLocked(assessmentId, locked);
  }

  /** CSV export of the grader report. */
  async exportCsv(courseOfferingId: string): Promise<string> {
    const report = await this.graderReport(courseOfferingId);
    const header = ['studentProfileId', ...report.items.map((i) => i.assessment?.title ?? i.id), 'total'];
    const lines = [header.join(',')];
    for (const s of report.students) {
      const cells = report.items.map((i) => (i.assessmentId ? s.cells[i.assessmentId]?.score ?? '' : ''));
      lines.push([s.studentProfileId, ...cells, s.total ?? ''].join(','));
    }
    return lines.join('\n');
  }

  /**
   * CSV import: rows of { studentAssessmentId, score }.
   *
   * Chunked rather than one transaction over the whole file — a class-sized
   * import in a single transaction holds row locks for its full duration, and
   * an unwrapped loop leaves a half-applied import behind on failure.
   */
  async importScores(rows: { studentAssessmentId: string; score: number }[]) {
    const CHUNK = 200;
    let n = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await this.prisma.client.$transaction(async (tx: Tx) => {
        for (const r of chunk) {
          await this.grades.setScore({ studentAssessmentId: r.studentAssessmentId, score: r.score, source: 'import' }, tx);
        }
      });
      n += chunk.length;
    }
    return { imported: n };
  }
}
