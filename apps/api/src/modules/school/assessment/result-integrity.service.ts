import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';

/**
 * Phase 5 — the reads and the correction workflow around a ResultSet.
 *
 * The computation itself stays in `ResultRunService`; this is what the results
 * office looks at before and after it: the run list, the detail with names, the
 * per-subject explanation of a number, and the amendment queue including the
 * refusal path a published correction has to survive.
 */
@Injectable()
export class ResultIntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    @Optional() private readonly dataScope?: DataScopeService,
  ) {}

  private get db(): any { return this.prisma.client; }

  // ── run list ───────────────────────────────────────────────────────────────

  /**
   * Every result set for a term, newest revision first, with enough context to
   * choose between them. This is the list `results.tsx` has always asked for.
   */
  async byTerm(termId: string, scopeId?: string) {
    // F09: a teacher sees the result sets of the classes/streams they teach.
    const seats = this.dataScope ? await this.dataScope.readableSeats() : 'all';
    const visibleScopes =
      seats === 'all' ? null : [...new Set(seats.flatMap((s) => [s.classId, ...(s.sectionId ? [s.sectionId] : [])]))];
    const sets = await this.db.resultSet.findMany({
      where: {
        termId,
        ...(scopeId ? { scopeId } : {}),
        ...(visibleScopes
          ? { scopeId: scopeId ? (visibleScopes.includes(scopeId) ? scopeId : '__none__') : { in: visibleScopes } }
          : {}),
      },
      orderBy: [{ revision: 'desc' }, { createdAt: 'desc' }],
      include: { run: true, _count: { select: { termResults: true, amendments: true } } },
    });
    const classIds = [...new Set(sets.map((s: any) => s.scopeId).filter(Boolean))] as string[];
    const classes = classIds.length
      ? await this.db.schoolClass.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
      : [];
    const className = new Map<string, string>((classes as any[]).map((c: any) => [c.id, c.name]));

    return sets.map((s: any) => ({
      id: s.id,
      termId: s.termId,
      rosterId: s.rosterId,
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      scopeName: s.scopeId ? className.get(s.scopeId) ?? null : null,
      status: s.status,
      revision: s.revision,
      calculationVersion: s.calculationVersion,
      gradingSystem: s.gradingSystem,
      studentCount: s.studentCount,
      publishedAt: s.publishedAt,
      computedAt: s.run?.completedAt ?? s.createdAt,
      inputChecksum: s.inputChecksum,
      outputChecksum: s.outputChecksum,
      amendmentCount: s._count.amendments,
      coveragePct: s.studentCount > 0 ? Math.round((s._count.termResults / s.studentCount) * 100) : null,
    }));
  }

  /** One result set in the shape the results screen renders. */
  async detail(id: string, studentProfileId?: string) {
    const rs = await this.db.resultSet.findFirst({
      where: { id },
      include: { termResults: true, subjectResults: true, run: true },
    });
    if (!rs) throw new NotFoundException(`ResultSet ${id} not found`);

    // F09: narrow to the pupils this caller may read, and to the one asked for.
    // Filtering only the subject rows used to hand back every pupil's term result.
    const allIds = [...new Set(rs.termResults.map((t: any) => t.studentProfileId))] as string[];
    const visible = this.dataScope ? await this.dataScope.visibleStudentIds(allIds) : 'all';
    const canSee = (sid: string) => (visible === 'all' || visible.has(sid)) && (!studentProfileId || sid === studentProfileId);
    if (studentProfileId && !canSee(studentProfileId)) {
      throw new ForbiddenException('You may only view the results of pupils you teach');
    }
    if (visible !== 'all' && !rs.termResults.some((t: any) => canSee(t.studentProfileId))) {
      throw new ForbiddenException('You may only view the results of pupils you teach');
    }
    rs.termResults = rs.termResults.filter((t: any) => canSee(t.studentProfileId));
    rs.subjectResults = rs.subjectResults.filter((r: any) => canSee(r.studentProfileId));

    const studentIds = [...new Set(rs.termResults.map((t: any) => t.studentProfileId))] as string[];
    const subjectIds = [...new Set(rs.subjectResults.map((s: any) => s.subjectId))] as string[];
    const [students, subjects] = await Promise.all([
      studentIds.length
        ? this.db.studentProfile.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, admissionNo: true, partner: { select: { name: true } } },
          })
        : [],
      subjectIds.length
        ? this.db.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true, code: true } })
        : [],
    ]);
    const student = new Map<string, any>((students as any[]).map((s: any) => [s.id, s]));
    const subject = new Map<string, any>((subjects as any[]).map((s: any) => [s.id, s]));

    const subjectRows = rs.subjectResults
      .filter((r: any) => !studentProfileId || r.studentProfileId === studentProfileId)
      .map((r: any) => ({
        ...r,
        subjectName: subject.get(r.subjectId)?.name ?? null,
        subjectCode: subject.get(r.subjectId)?.code ?? null,
        studentName: student.get(r.studentProfileId)?.partner?.name ?? null,
      }));

    return {
      resultSet: {
        ...rs,
        termResults: undefined,
        subjectResults: undefined,
        computedAt: rs.run?.completedAt ?? rs.createdAt,
        coveragePct: rs.studentCount > 0 ? Math.round((rs.termResults.length / rs.studentCount) * 100) : null,
      },
      subjects: subjectRows,
      students: rs.termResults
        .map((t: any) => ({
          ...t,
          studentName: student.get(t.studentProfileId)?.partner?.name ?? null,
          admissionNo: student.get(t.studentProfileId)?.admissionNo ?? null,
        }))
        .sort((a: any, b: any) => (a.classRank ?? 9999) - (b.classRank ?? 9999)),
    };
  }

  // ── explanation ────────────────────────────────────────────────────────────

  /**
   * Why is this learner's subject percentage what it is?
   *
   * Reads the frozen `componentBreakdown` the run stored, so the answer is the
   * arithmetic that actually produced the published number — not a fresh
   * calculation that might disagree with it.
   */
  async explain(resultSetId: string, studentProfileId: string) {
    await this.dataScope?.assertMayReadStudent(studentProfileId);
    const rs = await this.db.resultSet.findFirst({ where: { id: resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);

    const [term, subjects] = await Promise.all([
      this.db.studentTermResult.findFirst({ where: { resultSetId, studentProfileId } }),
      this.db.studentSubjectResult.findMany({ where: { resultSetId, studentProfileId } }),
    ]);
    if (!term) throw new NotFoundException('This learner has no result in that set');

    const subjectMeta = subjects.length
      ? await this.db.subject.findMany({
          where: { id: { in: subjects.map((s: any) => s.subjectId) } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const name = new Map<string, any>((subjectMeta as any[]).map((s: any) => [s.id, s]));

    // The evidence behind each subject, so the explanation names the assessments
    // rather than only their weights.
    const rows = await this.db.studentAssessment.findMany({
      where: { studentProfileId, termId: rs.termId, assessment: { deletedAt: null } },
      include: { assessment: { select: { id: true, title: true, kind: true, subjectId: true, componentId: true, maxScore: true } } },
    });

    return {
      resultSet: {
        id: rs.id, revision: rs.revision, status: rs.status, termId: rs.termId,
        gradingSystem: rs.gradingSystem, roundingMode: rs.roundingMode,
        calculationVersion: rs.calculationVersion,
        gradingScaleSnapshot: rs.gradingScaleSnapshot,
        rankingPolicySnapshot: rs.rankingPolicySnapshot,
        inputChecksum: rs.inputChecksum, outputChecksum: rs.outputChecksum,
      },
      term,
      subjects: subjects.map((s: any) => {
        const evidence = rows
          .filter((r: any) => r.assessment.subjectId === s.subjectId)
          .map((r: any) => ({
            assessmentId: r.assessment.id,
            title: r.assessment.title,
            kind: r.assessment.kind,
            componentId: r.assessment.componentId,
            score: r.effectiveScore,
            maxScore: r.maxScore,
            participation: r.participation,
            approvalStatus: r.approvalStatus,
            counted: r.effectiveScore != null && !['exempt', 'excused', 'not_enrolled', 'withdrawn'].includes(r.participation),
          }));
        return {
          subjectId: s.subjectId,
          subjectName: name.get(s.subjectId)?.name ?? null,
          subjectCode: name.get(s.subjectId)?.code ?? null,
          caScore: s.caScore,
          examScore: s.examScore,
          finalPercent: s.finalPercent,
          grade: s.grade,
          gradePoint: s.gradePoint,
          points: s.points,
          subjectRank: s.subjectRank,
          componentBreakdown: s.componentBreakdown ?? [],
          evidence,
        };
      }),
    };
  }

  // ── amendments ─────────────────────────────────────────────────────────────

  async amendmentsByResultSet(resultSetId: string) {
    const rows = await this.db.amendmentRequest.findMany({
      where: { resultSetId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a: any) => ({ ...a, canApprove: a.status === 'requested' }));
  }

  /** Everything outstanding across the term — the amendments tab's work queue. */
  async amendmentQueue(termId?: string) {
    const rows = await this.db.amendmentRequest.findMany({
      where: { ...(termId ? { resultSet: { termId } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { resultSet: { select: { id: true, termId: true, revision: true, status: true, scopeId: true } } },
    });
    return rows;
  }

  /**
   * Refuse an amendment.
   *
   * A published result that stays published because nobody acted on the request
   * is worse than one that was formally refused: the refusal is a decision, with
   * a reason, on the record. Approval lives in `ResultRunService` because it
   * recomputes.
   */
  async rejectAmendment(id: string, decisionNote: string) {
    if (!decisionNote?.trim()) throw new BadRequestException('A refusal needs a reason');
    return this.db.$transaction(async (tx: any) => {
      const amendment = await tx.amendmentRequest.findFirst({ where: { id } });
      if (!amendment) throw new NotFoundException(`AmendmentRequest ${id} not found`);
      if (amendment.status !== 'requested') throw new BadRequestException(`This request is already '${amendment.status}'`);
      const userId = this.tenant.userId ?? null;
      if (amendment.requestedById && userId && amendment.requestedById === userId) {
        throw new BadRequestException('An amendment is decided by someone other than whoever requested it');
      }
      await tx.amendmentRequest.updateMany({
        where: { id },
        data: { status: 'rejected', reviewedById: userId, reviewedAt: new Date(), decisionNote },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AmendmentRequest', entityId: id, action: 'reject',
        oldValues: { status: amendment.status },
        newValues: { status: 'rejected', decisionNote },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolResultsAmendmentRejected, {
        organizationId: this.tenant.organizationId,
        amendmentId: id,
        resultSetId: amendment.resultSetId,
      });
      return tx.amendmentRequest.findFirst({ where: { id } });
    });
  }
}
