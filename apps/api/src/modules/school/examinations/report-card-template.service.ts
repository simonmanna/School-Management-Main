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
   * B6 — the cutover is complete. `GradeEntry` is now read-only historic evidence
   * and the result spine (published `ResultSet`, or the live `StudentAssessment`
   * view) is the ONLY source a report card reads. There is no `grade_entry` or
   * `shadow` branch to flip back to: parity was proven by `school-gradeentry-
   * parity.spec.ts` against production-shaped data before this was removed.
   *
   * The `spine` argument is the already-fetched published result (from
   * `generate`), passed in to avoid a second query.
   */
  async buildLayout(
    studentProfileId: string,
    termId: string,
    spine?: { subjects: any[] } | null,
  ): Promise<{ layout: ReportCardLayout; layoutSource: 'result_spine' | 'spine_live' }> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const school = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
    });
    const system = (school?.gradingSystem ?? 'UCE') as GradingSystem;

    const spineSubjects = spine?.subjects ?? [];

    // 1) A published ResultSet is the authoritative, frozen term result.
    if (spineSubjects.length > 0) {
      const subjects = await this.subjectsFromSpine(spineSubjects, system);
      return { layout: this.layoutFor(system, subjects), layoutSource: 'result_spine' };
    }

    // 2) No published result for this term — but marks may still exist. Compute
    // from the live spine under the same policy and `computeSubject` kernel a
    // result run uses, so a card built this way agrees with one published later.
    const live = await this.subjectsFromSpineLive(studentProfileId, termId, system);
    if (live.length > 0) {
      return { layout: this.layoutFor(system, live), layoutSource: 'spine_live' };
    }

    // 3) Genuinely nothing: an empty card is the honest answer. (The legacy
    // GradeEntry fallback is gone — it only ever held exam marks and would
    // under-report a term that includes CATs, homework and projects.)
    return { layout: this.layoutFor(system, []), layoutSource: 'spine_live' };
  }

  private layoutFor(system: GradingSystem, subjects: SubjectResult[]): ReportCardLayout {
    switch (system) {
      case 'UCE': return this.buildUCELayout(subjects);
      case 'UACE': return this.buildUACELayout(subjects);
      case 'CBC': return this.buildCBCLayout(subjects);
      default: return this.buildGenericLayout(subjects);
    }
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

  /**
   * Compute this term's subjects from the LIVE spine, under the same policy and
   * the same `computeSubject` kernel a result run would use.
   *
   * This is what stands between "no published result" and the GradeEntry
   * fallback. It sees every kind of mark — CATs, homework, projects, practicals
   * and exams — where GradeEntry only ever held exam marks, so a card built this
   * way is strictly closer to the truth than the legacy path it precedes.
   *
   * It is NOT a substitute for a published result: nothing here is frozen, so a
   * later mark changes it. Publishing a ResultSet is still what makes a card
   * defensible.
   */
  private async subjectsFromSpineLive(
    studentProfileId: string,
    termId: string,
    system: GradingSystem,
  ): Promise<SubjectResult[]> {
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: {
        studentProfileId,
        termId,
        deletedAt: null,
        approvalStatus: 'approved',
        assessment: { deletedAt: null },
      },
      include: { assessment: { include: { component: true } } },
    });
    if (rows.length === 0) return [];

    const bySubject = new Map<string, typeof rows>();
    for (const r of rows) {
      const sid = r.assessment.subjectId;
      const list = bySubject.get(sid) ?? [];
      list.push(r);
      bySubject.set(sid, list);
    }

    const subjectMeta = await this.prisma.client.subject.findMany({
      where: { id: { in: [...bySubject.keys()] } },
    });
    const metaById = new Map(subjectMeta.map((m) => [m.id, m]));

    const out: SubjectResult[] = [];
    for (const [subjectId, group] of bySubject) {
      const meta = metaById.get(subjectId);
      const subjectName = meta?.name ?? subjectId;
      const subjectCode = meta?.code ?? '';

      // Group by weighting component so the per-component columns still print;
      // assessments no policy claims fall into one "other" bucket rather than
      // silently vanishing from the card.
      const buckets = new Map<string, { label: string; sum: number; n: number }>();
      for (const r of group) {
        if (r.percentage == null) continue;
        const kind = r.assessment.component?.kind ?? r.assessment.kind ?? 'other';
        const b = buckets.get(kind) ?? { label: this.componentLabel(kind), sum: 0, n: 0 };
        b.sum += Number(r.percentage);
        b.n += 1;
        buckets.set(kind, b);
      }
      if (buckets.size === 0) continue;

      const examScores = [] as SubjectResult['examScores'];
      let weighted = 0;
      let weightTotal = 0;
      for (const [kind, b] of buckets) {
        const pct = b.sum / b.n;
        const weight = Number(
          group.find((r) => (r.assessment.component?.kind ?? r.assessment.kind) === kind)?.assessment.component?.weight ?? 0,
        );
        const band = await this.grading.bandFor(pct, 100, system);
        examScores.push({
          examType: b.label,
          marks: Math.round(pct * 100) / 100,
          maxMarks: 100,
          grade: band?.grade ?? null,
          points: band?.points ?? null,
        });
        weighted += pct * (weight || 0);
        weightTotal += weight || 0;
      }

      // Weighted where a policy says how; a plain mean where it does not, which
      // is the same rule `computeSubject` applies to an unweighted subject.
      const totalPercent = Math.round(
        weightTotal > 0 ? weighted / weightTotal : examScores.reduce((s, e) => s + e.marks, 0) / examScores.length,
      );
      const band = await this.grading.bandFor(totalPercent, 100, system);
      out.push({
        subject: subjectName,
        subjectCode,
        isCompulsory: isCompulsorySubject(subjectName),
        isPrincipal: !isSubsidiarySubject(subjectName, subjectCode, system),
        examScores,
        totalPercent,
        finalGrade: band?.grade ?? null,
        finalPoints: band?.points ?? null,
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