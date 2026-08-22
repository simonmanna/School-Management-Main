import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { GradingService, type GradingSystem, type GradeBand } from './grading.service';

/**
 * ReportCardTemplateService — produces a fully-templated report card
 * payload and a printable layout tailored to Uganda's UCE, UACE, and
 * CBC grading systems.
 *
 * What this service does:
 *   1. Loads the student's GradeEntries for a term, broken out per subject.
 *   2. Resolves the grade letter + points using the chosen grading system.
 *   3. Builds the appropriate aggregate (best-8 for UCE, best-3 principals
 *      for UACE, competency level for CBC).
 *   4. Renders a layout descriptor the PDF service uses to lay out the page.
 *
 * The SchoolProfile.gradingSystem field controls which template is used.
 * Schools that haven't set it default to the legacy generic 9-point scale.
 */
export interface SubjectResult {
  subject: string;
  subjectCode?: string;
  isCompulsory?: boolean;       // UCE: English + Mathematics
  isPrincipal?: boolean;         // UACE: 3-4 principal subjects
  examScores: Array<{
    examType: string;
    marks: number;
    maxMarks: number;
    grade: string | null;
    points: number | null;
  }>;
  totalPercent: number;          // averaged across exam types
  finalGrade: string | null;     // e.g. "D1", "B", "Exceeding"
  finalPoints: number | null;     // UCE: 1..9, UACE: 5..11
  remark?: string | null;
}

export interface ReportCardLayout {
  /** The grading system in use; drives header text and column layout. */
  system: GradingSystem | string;
  /** Column labels in the order they should appear. */
  columnHeaders: string[];
  /** Sections to render in the body (subjects by group). */
  sections: Array<{
    title: string;
    subjects: SubjectResult[];
  }>;
  /** Aggregate / summary block. */
  summary: Array<{ label: string; value: string }>;
  /** Eligibility verdict for the certificate (UCE only — pass/fail cert). */
  eligible?: { qualifies: boolean; reason: string };
  /** Footer text (e.g. principal signature line, "Valid only with school stamp"). */
  footer: string[];
}

@Injectable()
export class ReportCardTemplateService {
  private readonly logger = new Logger(ReportCardTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly grading: GradingService,
  ) {}

  /**
   * Build the layout for a student + term.
   *
   * SINGLE SOURCE (P3): the subject table a parent reads is derived, in order,
   * from
   *   1. the published result spine (StudentSubjectResult) — the same rows the
   *      transcript, the portal and the headline GPA already use, so the body
   *      and the header of the card can no longer disagree;
   *   2. the raw GradeEntry marks, the legacy path, for a historic term that was
   *      never run through the spine.
   *
   * `REPORT_CARD_SOURCE` gates the cutover: `spine` (default) prefers the spine,
   * `grade_entry` forces the legacy path, `shadow` computes both and logs any
   * divergence while still returning the legacy layout — so a full reporting
   * cycle can be compared before the flip. Flip between terms, never mid-term.
   *
   * The `spine` argument is the already-fetched published result (from
   * `generate`), passed in to avoid a second query.
   */
  async buildLayout(
    studentProfileId: string,
    termId: string,
    spine?: { subjects: any[] } | null,
  ): Promise<{ layout: ReportCardLayout; layoutSource: 'result_spine' | 'grade_entry' }> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const school = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
    });
    const system = (school?.gradingSystem ?? 'UCE') as GradingSystem;
    const mode = (process.env.REPORT_CARD_SOURCE ?? 'spine') as 'spine' | 'grade_entry' | 'shadow';

    const spineSubjects = spine?.subjects ?? [];
    const canUseSpine = mode !== 'grade_entry' && spineSubjects.length > 0;

    if (mode === 'shadow' && spineSubjects.length > 0) {
      // Compute both, return legacy, but flag where they disagree.
      const [legacy, fromSpine] = await Promise.all([
        this.subjectsFromGradeEntry(studentProfileId, termId, system),
        this.subjectsFromSpine(spineSubjects, system),
      ]);
      this.warnOnDivergence(studentProfileId, termId, legacy, fromSpine);
      return { layout: this.layoutFor(system, legacy), layoutSource: 'grade_entry' };
    }

    if (canUseSpine) {
      const subjects = await this.subjectsFromSpine(spineSubjects, system);
      return { layout: this.layoutFor(system, subjects), layoutSource: 'result_spine' };
    }

    const subjects = await this.subjectsFromGradeEntry(studentProfileId, termId, system);
    return { layout: this.layoutFor(system, subjects), layoutSource: 'grade_entry' };
  }

  private layoutFor(system: GradingSystem, subjects: SubjectResult[]): ReportCardLayout {
    switch (system) {
      case 'UCE': return this.buildUCELayout(subjects);
      case 'UACE': return this.buildUACELayout(subjects);
      case 'CBC': return this.buildCBCLayout(subjects);
      default: return this.buildGenericLayout(subjects);
    }
  }

  /** Legacy path: raw GradeEntry marks bucketed per subject. */
  private async subjectsFromGradeEntry(studentProfileId: string, termId: string, system: GradingSystem): Promise<SubjectResult[]> {
    const entries = await this.prisma.client.gradeEntry.findMany({
      where: { studentProfileId, examSchedule: { exam: { termId } }, status: 'approved' },
      include: { examSchedule: { include: { subject: true, exam: { include: { examType: true } } } } },
    });

    const bySubject: Record<string, SubjectResult> = {};
    for (const e of entries) {
      const sid = e.examSchedule.subjectId;
      const subjectName = e.examSchedule.subject.name;
      const subjectCode = e.examSchedule.subject.code;
      if (!bySubject[sid]) {
        bySubject[sid] = {
          subject: subjectName,
          subjectCode,
          isCompulsory: isCompulsorySubject(subjectName),
          isPrincipal: !isSubsidiarySubject(subjectName, subjectCode, system),
          examScores: [],
          totalPercent: 0,
          finalGrade: null,
          finalPoints: null,
        };
      }
      const band = await this.grading.bandFor(Number(e.marksObtained ?? 0), Number(e.maxMarks), system);
      bySubject[sid].examScores.push({
        examType: e.examSchedule.exam.examType.name,
        marks: Number(e.marksObtained ?? 0),
        maxMarks: Number(e.maxMarks),
        grade: band?.grade ?? null,
        points: band?.points ?? null,
      });
    }
    for (const sid of Object.keys(bySubject)) {
      const s = bySubject[sid];
      const total = s.examScores.reduce((sum, x) => sum + (x.marks / x.maxMarks) * 100, 0);
      s.totalPercent = s.examScores.length > 0 ? Math.round(total / s.examScores.length) : 0;
      const band = await this.grading.bandFor(s.totalPercent, 100, system);
      s.finalGrade = band?.grade ?? null;
      s.finalPoints = band?.points ?? null;
      s.remark = band?.remark ?? null;
    }
    return Object.values(bySubject);
  }

  /**
   * Spine path: the published StudentSubjectResult rows, already computed by the
   * result run under the same policy. Each component becomes one `examScores`
   * row (its achieved percentage), so the per-exam-type columns still populate.
   */
  private async subjectsFromSpine(spineSubjects: any[], system: GradingSystem): Promise<SubjectResult[]> {
    const subjectIds = [...new Set(spineSubjects.map((s) => s.subjectId))];
    const subjectMeta = await this.prisma.client.subject.findMany({ where: { id: { in: subjectIds } } });
    const metaById = new Map(subjectMeta.map((m) => [m.id, m]));

    const out: SubjectResult[] = [];
    for (const ssr of spineSubjects) {
      const meta = metaById.get(ssr.subjectId);
      const subjectName = meta?.name ?? ssr.subjectId;
      const subjectCode = meta?.code ?? '';
      const breakdown: Array<{ componentId: string; kind: string; componentPercent: string | null }> =
        Array.isArray(ssr.componentBreakdown) ? ssr.componentBreakdown : [];

      const examScores = [] as SubjectResult['examScores'];
      for (const c of breakdown) {
        const pct = c.componentPercent != null ? Number(c.componentPercent) : null;
        const band = pct != null ? await this.grading.bandFor(pct, 100, system) : null;
        examScores.push({
          examType: this.componentLabel(c.kind),
          marks: pct != null ? Math.round(pct * 100) / 100 : 0,
          maxMarks: 100,
          grade: band?.grade ?? null,
          points: band?.points ?? null,
        });
      }

      const totalPercent = ssr.finalPercent != null ? Math.round(Number(ssr.finalPercent)) : 0;
      const band = ssr.finalPercent != null ? await this.grading.bandFor(totalPercent, 100, system) : null;
      out.push({
        subject: subjectName,
        subjectCode,
        isCompulsory: isCompulsorySubject(subjectName),
        isPrincipal: !isSubsidiarySubject(subjectName, subjectCode, system),
        examScores,
        totalPercent,
        finalGrade: ssr.grade ?? band?.grade ?? null,
        finalPoints: ssr.points ?? band?.points ?? null,
        remark: band?.remark ?? null,
      });
    }
    return out;
  }

  private componentLabel(kind: string): string {
    const map: Record<string, string> = {
      exam: 'Exam', cat: 'CAT', homework: 'Homework', classwork: 'Classwork',
      practical: 'Practical', project: 'Project', oral: 'Oral', attendance: 'Attendance',
    };
    return map[kind] ?? kind;
  }

  private warnOnDivergence(studentProfileId: string, termId: string, legacy: SubjectResult[], spine: SubjectResult[]) {
    const spineByName = new Map(spine.map((s) => [s.subject, s]));
    for (const l of legacy) {
      const s = spineByName.get(l.subject);
      if (!s) {
        this.logger.warn(`[report-card shadow] ${studentProfileId}/${termId}: "${l.subject}" present in GradeEntry but not the spine`);
        continue;
      }
      if (l.finalGrade !== s.finalGrade || Math.abs(l.totalPercent - s.totalPercent) > 1) {
        this.logger.warn(
          `[report-card shadow] ${studentProfileId}/${termId}: "${l.subject}" diverges — ` +
            `GradeEntry ${l.totalPercent}% ${l.finalGrade} vs spine ${s.totalPercent}% ${s.finalGrade}`,
        );
      }
    }
  }

  // ── Templates ──────────────────────────────────────────────────────────

  private buildUCELayout(subjects: SubjectResult[]): ReportCardLayout {
    const agg = this.grading.computeUCEAggregate(
      subjects.map((s) => ({ subject: s.subject, points: s.finalPoints, isCompulsory: s.isCompulsory })),
    );
    return {
      system: 'UCE',
      columnHeaders: ['Subject', 'Code', 'CAT 30', 'Midterm 30', 'Final 40', 'Grade', 'Points', 'Remark'],
      sections: [{ title: 'Subjects', subjects }],
      summary: [
        { label: 'Best 8 Aggregate', value: `${agg.best8Aggregate} / 72 (best possible = 8)` },
        { label: 'Compulsory Pass', value: agg.compulsoryPass ? 'Yes' : 'No' },
        { label: 'F9 Count', value: `${agg.f9Count}` },
      ],
      eligible: {
        qualifies: agg.eligible,
        reason: agg.eligible
          ? 'Eligible for the Uganda Certificate of Education.'
          : !agg.compulsoryPass
            ? 'Not eligible: English or Mathematics is F9.'
            : 'Not eligible: more than three F9 grades.',
      },
      footer: [
        'Issued under the Uganda National Examinations Board (UNEB) grading system.',
        'Principal signature: ____________________   School stamp: ____________________',
      ],
    };
  }

  private buildUACELayout(subjects: SubjectResult[]): ReportCardLayout {
    const agg = this.grading.computeUACEAggregate(
      subjects.map((s) => ({ subject: s.subject, points: s.finalPoints, isPrincipal: s.isPrincipal })),
    );
    return {
      system: 'UACE',
      columnHeaders: ['Subject', 'Code', 'Paper 1', 'Paper 2', 'Paper 3', 'Grade', 'Points', 'Remark'],
      sections: [
        {
          title: `Principal Subjects (${agg.principalCount})`,
          subjects: subjects.filter((s) => s.isPrincipal),
        },
        {
          title: `Subsidiary Subjects (${agg.subsidiaries.length})`,
          subjects: subjects.filter((s) => !s.isPrincipal),
        },
      ],
      summary: [
        { label: 'Best 3 Principal Aggregate', value: `${agg.best3Aggregate} (lower is better)` },
        { label: 'Principal Subjects Count', value: `${agg.principalCount}` },
      ],
      footer: [
        'Issued under the Uganda Advanced Certificate of Education (UACE) grading system.',
        'Principal signature: ____________________   School stamp: ____________________',
      ],
    };
  }

  private buildCBCLayout(subjects: SubjectResult[]): ReportCardLayout {
    return {
      system: 'CBC',
      columnHeaders: ['Strand', 'Code', 'Activity Score', 'Project', 'End-of-Term', 'Level', 'Remark'],
      sections: [{ title: 'Competency Strands', subjects }],
      summary: [
        { label: 'Strands Assessed', value: `${subjects.length}` },
      ],
      footer: [
        'Issued under the Competency-Based Curriculum (CBC) assessment framework.',
        'Class teacher: ____________________   Head teacher: ____________________',
      ],
    };
  }

  private buildGenericLayout(subjects: SubjectResult[]): ReportCardLayout {
    return {
      system: 'generic',
      columnHeaders: ['Subject', 'Code', 'Marks', 'Max', 'Percent', 'Grade', 'Remark'],
      sections: [{ title: 'Subjects', subjects }],
      summary: [
        { label: 'Subjects Assessed', value: `${subjects.length}` },
      ],
      footer: [
        'Issued under the school’s internal grading system.',
      ],
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isCompulsorySubject(name: string): boolean {
  return /english|mathematics/i.test(name);
}

/**
 * P0-3 (C3): subsidiary detection.
 *
 * Under UACE, students take 3–4 principal subjects (their chosen
 * specialisation) and a small set of compulsory subsidiary subjects
 * (typically General Paper and Sub-ICT). Only principal subjects
 * count toward the "best 3" UACE aggregate.
 *
 * The school tags subsidiary subjects in `Subject.code` with the
 * `SUB-` prefix (e.g. `SUB-GP`, `SUB-ICT`). Names alone are
 * unreliable — many schools call their principal subjects "GP" too.
 *
 * Other grading systems (UCE, CBC, generic) have no concept of
 * subsidiary subjects, so the function always returns false there.
 *
 * Exported for unit testing.
 */
export function isSubsidiarySubject(
  name: string,
  code: string | undefined,
  system: GradingSystem | string,
): boolean {
  if (system !== 'UACE') return false;
  if (!code) return false;
  return /^sub-/i.test(code);
}