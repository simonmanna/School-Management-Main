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
   * Build the layout for a student + term. The school's `gradingSystem`
   * field selects the template. Falls back to 'generic' if unknown.
   */
  async buildLayout(studentProfileId: string, termId: string): Promise<ReportCardLayout> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!profile) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const school = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
    });
    const system = (school?.gradingSystem ?? 'UCE') as GradingSystem;

    // Pull all GradeEntries for this term, grouped by subject.
    const entries = await this.prisma.client.gradeEntry.findMany({
      where: {
        studentProfileId,
        examSchedule: { exam: { termId } },
        status: 'approved',
      },
      include: { examSchedule: { include: { subject: true, exam: { include: { examType: true } } } } },
    });

    // Bucket per subject.
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
    // Compute final percent + grade per subject.
    for (const sid of Object.keys(bySubject)) {
      const s = bySubject[sid];
      const total = s.examScores.reduce((sum, x) => sum + (x.marks / x.maxMarks) * 100, 0);
      s.totalPercent = s.examScores.length > 0 ? Math.round(total / s.examScores.length) : 0;
      const band = await this.grading.bandFor(s.totalPercent, 100, system);
      s.finalGrade = band?.grade ?? null;
      s.finalPoints = band?.points ?? null;
      s.remark = band?.remark ?? null;
    }

    const subjects = Object.values(bySubject);

    switch (system) {
      case 'UCE': return this.buildUCELayout(subjects);
      case 'UACE': return this.buildUACELayout(subjects);
      case 'CBC': return this.buildCBCLayout(subjects);
      default: return this.buildGenericLayout(subjects);
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