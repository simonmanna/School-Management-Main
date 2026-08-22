import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/**
 * Academic analytics (A7). Everything is read off the published result spine
 * (StudentSubjectResult / StudentTermResult) or StudentAssessment — never raw
 * marks — and every result is pinned to the ResultSet id + revision it came
 * from, so a dashboard number is always traceable. Three tiers are kept
 * separate: descriptive, diagnostic, predictive; plus operational metrics.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async pin(resultSetId: string) {
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);
    return { resultSetId, resultSetRevision: rs.revision, termId: rs.termId };
  }

  private num(v: Prisma.Decimal | number | null): number {
    return v == null ? 0 : Number(v);
  }

  // ── Descriptive ────────────────────────────────────────────────────────────
  async gradeDistribution(resultSetId: string) {
    const meta = await this.pin(resultSetId);
    const rows = await this.prisma.client.studentSubjectResult.groupBy({
      by: ['grade'],
      where: { resultSetId, grade: { not: null } },
      _count: { _all: true },
    });
    return { ...meta, distribution: rows.map((r: any) => ({ grade: r.grade, count: r._count._all })).sort((a: any, b: any) => (a.grade > b.grade ? 1 : -1)) };
  }

  async subjectPerformance(resultSetId: string, passMark = 50) {
    const meta = await this.pin(resultSetId);
    const rows = await this.prisma.client.studentSubjectResult.findMany({ where: { resultSetId }, select: { subjectId: true, finalPercent: true } });
    const bySubject = new Map<string, number[]>();
    for (const r of rows) {
      if (r.finalPercent == null) continue;
      if (!bySubject.has(r.subjectId)) bySubject.set(r.subjectId, []);
      bySubject.get(r.subjectId)!.push(this.num(r.finalPercent));
    }
    const subjects = [...bySubject.entries()].map(([subjectId, pcts]) => ({
      subjectId,
      count: pcts.length,
      mean: round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
      median: median(pcts),
      passRate: round((pcts.filter((p) => p >= passMark).length / pcts.length) * 100),
    }));
    return { ...meta, subjects };
  }

  async classPerformance(resultSetId: string, passMark = 50) {
    const meta = await this.pin(resultSetId);
    const terms = await this.prisma.client.studentTermResult.findMany({ where: { resultSetId }, select: { meanPercent: true, gpa: true, eligible: true } });
    const means = terms.map((t: any) => this.num(t.meanPercent)).filter((n) => n > 0);
    return {
      ...meta,
      studentCount: terms.length,
      meanPercent: means.length ? round(means.reduce((a, b) => a + b, 0) / means.length) : 0,
      passRate: terms.length ? round((terms.filter((t: any) => this.num(t.meanPercent) >= passMark).length / terms.length) * 100) : 0,
      eligibleRate: terms.length ? round((terms.filter((t: any) => t.eligible).length / terms.length) * 100) : 0,
    };
  }

  /** Term-over-term trend for one student, across published result sets. */
  async studentTrend(studentProfileId: string) {
    const terms = await this.prisma.client.studentTermResult.findMany({
      where: { studentProfileId, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      studentProfileId,
      points: terms.map((t: any) => ({ termId: t.termId, resultSetRevision: t.resultSet.revision, meanPercent: this.num(t.meanPercent), gpa: this.num(t.gpa), classRank: t.classRank })),
    };
  }

  // ── Diagnostic ─────────────────────────────────────────────────────────────
  /** Subjects where CA and exam scores diverge sharply — flags marking anomalies. */
  async caVsExamDivergence(resultSetId: string, threshold = 25) {
    const meta = await this.pin(resultSetId);
    const rows = await this.prisma.client.studentSubjectResult.findMany({
      where: { resultSetId, caScore: { not: null }, examScore: { not: null } },
      select: { studentProfileId: true, subjectId: true, caScore: true, examScore: true },
    });
    const flagged = rows
      .map((r: any) => ({ studentProfileId: r.studentProfileId, subjectId: r.subjectId, caScore: this.num(r.caScore), examScore: this.num(r.examScore), gap: Math.abs(this.num(r.caScore) - this.num(r.examScore)) }))
      .filter((r) => r.gap > threshold)
      .sort((a, b) => b.gap - a.gap);
    return { ...meta, threshold, flagged };
  }

  // ── Predictive ─────────────────────────────────────────────────────────────
  /** At-risk register — each entry carries the RULE that flagged it, not a bare score. */
  async atRisk(resultSetId: string, passMark = 50) {
    const meta = await this.pin(resultSetId);
    const terms = await this.prisma.client.studentTermResult.findMany({ where: { resultSetId } });
    const subjects = await this.prisma.client.studentSubjectResult.findMany({ where: { resultSetId } });
    const register = [];
    for (const t of terms) {
      const reasons: string[] = [];
      if (!t.eligible) reasons.push('not_eligible');
      if (this.num(t.meanPercent) < passMark) reasons.push(`mean_below_pass(${this.num(t.meanPercent)}<${passMark})`);
      const failing = subjects.filter((s: any) => s.studentProfileId === t.studentProfileId && s.finalPercent != null && this.num(s.finalPercent) < passMark);
      if (failing.length >= 3) reasons.push(`failing_${failing.length}_subjects`);
      if (reasons.length > 0) {
        register.push({ studentProfileId: t.studentProfileId, meanPercent: this.num(t.meanPercent), failingSubjects: failing.length, reasons });
      }
    }
    return { ...meta, passMark, register: register.sort((a, b) => a.meanPercent - b.meanPercent) };
  }

  // ── Operational ────────────────────────────────────────────────────────────
  /** Assignment completion / late / missing rates for a class-term. */
  async assignmentMetrics(classId: string, termId: string) {
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { classId, termId, assessment: { sourceType: 'assignment', deletedAt: null } },
      select: { status: true },
    });
    const total = rows.length;
    const count = (fn: (s: string) => boolean) => rows.filter((r: any) => fn(r.status)).length;
    const submitted = count((s) => ['submitted', 'resubmitted', 'graded'].includes(s));
    const graded = count((s) => s === 'graded');
    const missing = count((s) => s === 'assigned');
    return {
      classId, termId, totalAssigned: total,
      submissionRate: total ? round((submitted / total) * 100) : 0,
      gradedRate: total ? round((graded / total) * 100) : 0,
      missingRate: total ? round((missing / total) * 100) : 0,
    };
  }

  /** Exam attendance breakdown from candidate registrations. */
  async examAttendance(examId: string) {
    const rows = await this.prisma.client.examRegistration.groupBy({ by: ['status'], where: { examId }, _count: { _all: true } });
    const byStatus = Object.fromEntries(rows.map((r: any) => [r.status, r._count._all]));
    const total = rows.reduce((acc: number, r: any) => acc + r._count._all, 0);
    return {
      examId, total, byStatus,
      attendanceRate: total ? round(((byStatus['sat'] ?? 0) / total) * 100) : 0,
      absenceRate: total ? round(((byStatus['absent'] ?? 0) / total) * 100) : 0,
    };
  }

  /** Replaces the 3-number academicDashboard: one pinned snapshot per result set. */
  async overview(resultSetId: string) {
    const [cls, dist, subj, risk] = await Promise.all([
      this.classPerformance(resultSetId),
      this.gradeDistribution(resultSetId),
      this.subjectPerformance(resultSetId),
      this.atRisk(resultSetId),
    ]);
    return { ...cls, gradeDistribution: dist.distribution, subjects: subj.subjects, atRiskCount: risk.register.length };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}
