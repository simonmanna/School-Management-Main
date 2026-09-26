import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ResultSet } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { assertTermWritable } from '../foundation/academic-year-guard';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { AssessmentPolicyService } from './assessment-config.service';
import { resolveScale, type ResolvedScale } from './grade-bands';
import { isCompulsorySubject, isSubsidiarySubject, isPleCoreSubject } from './subject-roles';
import {
  computeResultSet,
  InvalidGradingScaleError,
  type AssessmentDatum,
  type ResultInput,
  type ResultOutput,
  type StudentInput,
  type SubjectInput,
} from './result-computation';
import type { ComputeResultsDto, RequestAmendmentDto } from './dto.types';
import { kindOf } from './assessment-math';
import {
  PENDING_RESULT_STATUSES,
  RELEASED_RESULT_STATUSES,
  releasedResultSetWhere,
  resultLockKey,
} from './result-status';

interface PublishConflict {
  code: string;
  studentProfileId?: string;
  subjectId?: string;
  detail: string;
}

/** Participation values that RESOLVE a learner row without a score. */
const TERMINAL_PARTICIPATION = ['exempt', 'excused', 'absent', 'malpractice', 'withdrawn', 'not_enrolled'];
/** Participation values that count without an approval (there is no mark to approve). */
const APPROVAL_FREE_PARTICIPATION = ['exempt', 'excused', 'absent', 'malpractice'];

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

type Reporting = { gradingSystem: string; rankOn: ResultInput['rankOn'] };

/**
 * The result spine's engine (A3). `compute` projects a frozen roster's approved
 * marks into an immutable, versioned ResultSet under a snapshotted policy;
 * `publish` runs the all-or-nothing gate that lets a computed set become the
 * authoritative record.
 *
 * Released results (published or locked) are never retired by computing. A
 * recomputation is a pending revision beside the released one; it replaces it
 * only when an approved amendment is published (F04). Publication re-derives
 * the input from today's approved evidence and refuses a stale snapshot (F05).
 */
@Injectable()
export class ResultRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly policies: AssessmentPolicyService,
  ) {}

  // ── compute ──────────────────────────────────────────────────────────────
  async compute(dto: ComputeResultsDto): Promise<ResultSet> {
    const organizationId = this.tenant.organizationId;

    // Idempotency: a repeated key returns the run's existing result set.
    if (dto.idempotencyKey) {
      const prior = await this.prisma.client.resultProcessingRun.findFirst({
        where: { idempotencyKey: dto.idempotencyKey },
        include: { resultSets: true },
      });
      if (prior?.resultSets?.length) {
        return this.findResultSet(prior.resultSets[prior.resultSets.length - 1].id);
      }
    }

    const roster = await this.prisma.client.academicRoster.findFirst({
      where: { id: dto.rosterId },
      include: { members: true },
    });
    if (!roster) throw new NotFoundException(`Roster ${dto.rosterId} not found`);
    if (!roster.frozenAt) throw new BadRequestException('Roster must be frozen before results can be computed');

    const scopeType = dto.scopeType ?? 'class';
    const scopeId = dto.scopeId ?? (scopeType === 'section' ? roster.sectionId : roster.classId) ?? null;
    this.assertRosterFitsScope(roster, dto.termId, scopeType, scopeId);

    const { input, output, reporting, scale, contributing } = await this.run(this.prisma.client, roster, dto.termId);
    const inputChecksum = sha(input);
    const outputChecksum = sha(output);

    return this.prisma.client.$transaction(async (tx: any) => {
      // Re-audit #3 P1-14: re-running results for a closed year archived the
      // published set and changed promotion recommendations after the fact.
      await assertTermWritable(tx, organizationId, dto.termId);

      // F04: a released set stays the school's answer until its replacement is
      // published. Recomputing over it is an amendment, and needs one approved.
      const released = await tx.resultSet.findFirst({
        where: { termId: dto.termId, scopeType, scopeId, status: { in: [...RELEASED_RESULT_STATUSES] }, deletedAt: null },
      });
      if (released) {
        const approved = await tx.amendmentRequest.findFirst({ where: { resultSetId: released.id, status: 'approved' } });
        if (!approved) {
          throw new BadRequestException({
            code: 'AMENDMENT_REQUIRED',
            message: 'These results are already released. Request an amendment and have it approved before recomputing.',
          });
        }
      }

      // A pending (unreleased) revision is a draft: the new computation replaces it.
      await tx.resultSet.deleteMany({
        where: { termId: dto.termId, scopeType, scopeId, status: { in: [...PENDING_RESULT_STATUSES] } },
      });
      const latest = await tx.resultSet.findFirst({
        where: { termId: dto.termId, scopeType, scopeId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      const revision = (latest?.revision ?? 0) + 1;

      const run = await tx.resultProcessingRun.create({
        data: {
          organizationId,
          termId: dto.termId,
          scopeType,
          scopeId,
          rosterId: roster.id,
          calculationVersion: dto.calculationVersion ?? 'v1',
          status: 'running',
          initiatedById: this.tenant.userId ?? null,
          startedAt: new Date(),
          inputChecksum,
          idempotencyKey: dto.idempotencyKey ?? null,
        },
      });

      const resultSet = await tx.resultSet.create({
        data: {
          organizationId,
          runId: run.id,
          termId: dto.termId,
          scopeType,
          scopeId,
          rosterId: roster.id,
          revision,
          status: 'computed',
          calculationVersion: dto.calculationVersion ?? 'v1',
          roundingMode: 'half_up',
          gradingSystem: reporting.gradingSystem,
          gradingScaleSnapshot: { bands: scale.bands, bandRounding: scale.rounding, scaleId: scale.scaleId } as any,
          rankingPolicySnapshot: { rankOn: input.rankOn } as any,
          inputChecksum,
          outputChecksum,
          studentCount: output.students.length,
        },
      });

      // Bulk inserts: a 350-pupil class is 700+ rows, which one-at-a-time
      // creates could not finish inside the transaction budget.
      const memberOf = new Map<string, any>(roster.members.map((m: any) => [m.studentProfileId, m]));
      const subjectRows: any[] = [];
      const termRows: any[] = [];
      for (const s of output.students) {
        const member = memberOf.get(s.studentProfileId);
        const position = {
          classId: member?.classId ?? null,
          sectionId: member?.sectionId ?? null,
          gradeLevelId: member?.gradeLevelId ?? null,
          termId: dto.termId,
        };
        for (const sub of s.subjects) {
          subjectRows.push({
            organizationId,
            resultSetId: resultSet.id,
            studentProfileId: s.studentProfileId,
            subjectId: sub.subjectId,
            ...position,
            caScore: sub.caScore ?? null,
            examScore: sub.examScore ?? null,
            finalPercent: sub.finalPercent ?? null,
            grade: sub.grade,
            gradePoint: sub.gradePoint ?? null,
            points: sub.points ?? null,
            subjectRank: sub.subjectRank ?? null,
            componentBreakdown: sub.componentBreakdown as any,
          });
        }
        termRows.push({
          organizationId,
          resultSetId: resultSet.id,
          studentProfileId: s.studentProfileId,
          ...position,
          gpa: s.term.gpa ?? null,
          aggregate: s.term.aggregate ?? null,
          division: s.term.division ?? null,
          meanPercent: s.term.meanPercent ?? null,
          classRank: s.term.classRank ?? null,
          subjectsCount: s.term.subjectsCount,
          eligible: s.term.eligible,
          promotionRecommendation: s.term.promotionRecommendation,
        });
      }
      for (let k = 0; k < subjectRows.length; k += 1000) await tx.studentSubjectResult.createMany({ data: subjectRows.slice(k, k + 1000) });
      for (let k = 0; k < termRows.length; k += 1000) await tx.studentTermResult.createMany({ data: termRows.slice(k, k + 1000) });

      await tx.resultProcessingRun.updateMany({
        where: { id: run.id },
        data: {
          status: 'succeeded',
          completedAt: new Date(),
          outputChecksum,
          report: { studentCount: output.students.length, contributingAssessments: contributing.length, revision } as any,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ResultSet',
        entityId: resultSet.id,
        action: 'create',
        newValues: { termId: dto.termId, scopeType, scopeId, revision, studentCount: output.students.length },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolResultsComputed, {
        organizationId,
        resultSetId: resultSet.id,
        termId: dto.termId,
        revision,
        studentCount: output.students.length,
      });
      return tx.resultSet.findFirst({ where: { id: resultSet.id } });
    }, { timeout: 120_000, maxWait: 15_000 });
  }

  /**
   * F06: a roster answers "who was in this audience in this term". Results for
   * a class must be built from that class's complete list for the same term —
   * not last term's, not a subject group's, not one stream's.
   */
  private assertRosterFitsScope(roster: any, termId: string, scopeType: string, scopeId: string | null) {
    const refuse = (message: string): never => {
      throw new BadRequestException({ code: 'ROSTER_SCOPE_MISMATCH', message });
    };
    if (roster.termId !== termId) refuse('This class list was captured for a different term. Capture one for this term.');
    if (roster.subjectId) refuse('A subject group list cannot produce whole-class results. Use the class list.');
    if (scopeType === 'class') {
      if (roster.scopeType !== 'class' || roster.sectionId) refuse('Class results need the whole class list, not one stream.');
      if (!scopeId || roster.classId !== scopeId) refuse('This list belongs to a different class.');
    } else if (scopeType === 'section') {
      if (!scopeId || roster.sectionId !== scopeId) refuse('This list belongs to a different stream.');
    } else if (scopeType === 'grade') {
      if (roster.scopeType !== 'grade') refuse('Grade-wide results need a grade-wide list.');
    } else {
      refuse(`Results for scope "${scopeType}" are not supported yet.`);
    }
  }

  /** Build the pure input for a roster and run the kernel. Deterministic. */
  private async run(db: any, roster: any, termId: string) {
    const reporting = await this.resolveReporting(db, roster, termId);
    let scale: ResolvedScale;
    try {
      scale = await resolveScale(db, reporting.gradingSystem);
    } catch (e) {
      if (e instanceof InvalidGradingScaleError) throw new BadRequestException(e.message);
      throw e;
    }
    const { students, contributing } = await this.buildInput(db, roster, termId);
    const input: ResultInput = {
      gradingSystem: reporting.gradingSystem as ResultInput['gradingSystem'],
      bands: scale.bands,
      bandRounding: scale.rounding,
      roundingMode: 'half_up',
      decimalPlaces: 2,
      rankOn: reporting.rankOn,
      students,
    };
    let output: ResultOutput;
    try {
      output = computeResultSet(input);
    } catch (e) {
      if (e instanceof InvalidGradingScaleError) throw new BadRequestException(e.message);
      throw e;
    }
    return { input, output, reporting, scale, contributing };
  }

  // ── lock ──────────────────────────────────────────────────────────────────
  /** Irreversibly freeze a published ResultSet. Only published sets may be locked;
   *  corrections then go through an AmendmentRequest → new revision. A locked
   *  set remains released (F16). */
  async lock(resultSetId: string): Promise<ResultSet> {
    const organizationId = this.tenant.organizationId;
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);
    if (rs.status !== 'published') {
      throw new BadRequestException(`ResultSet ${resultSetId} is '${rs.status}', only published sets can be locked`);
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.resultSet.updateMany({ where: { id: resultSetId }, data: { status: 'locked' } });
      await this.audit.recordInTx(tx, {
        entity: 'ResultSet',
        entityId: resultSetId,
        action: 'post',
        newValues: { action: 'lock', revision: rs.revision },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolResultsLocked, {
        organizationId, resultSetId, termId: rs.termId, revision: rs.revision,
      });
      return tx.resultSet.findFirst({ where: { id: resultSetId } });
    });
  }

  // ── publish ───────────────────────────────────────────────────────────────
  /**
   * Release a computed set. Everything that decides whether it may be released
   * runs inside one transaction holding the term's result lock (shared with mark
   * approval) and a row lock on the set: the gate, the freshness check, and the
   * swap from the previous released revision. A mark approved a moment after the
   * gate cannot slip under a publish that has already checked it.
   */
  async publish(resultSetId: string): Promise<ResultSet> {
    const organizationId = this.tenant.organizationId;
    const pre = await this.prisma.client.resultSet.findFirst({ where: { id: resultSetId } });
    if (!pre) throw new NotFoundException(`ResultSet ${resultSetId} not found`);
    if (!['computed', 'approved'].includes(pre.status)) {
      throw new BadRequestException(`ResultSet ${resultSetId} is '${pre.status}', not publishable`);
    }

    return this.prisma.client.$transaction(
      async (tx: any) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${resultLockKey(organizationId, pre.termId)}))`;
        await tx.$queryRawUnsafe('SELECT id FROM "ResultSet" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE', resultSetId, organizationId);
        const rs = await tx.resultSet.findFirst({
          where: { id: resultSetId },
          include: { termResults: true, subjectResults: true },
        });
        if (!rs || !['computed', 'approved'].includes(rs.status)) {
          throw new BadRequestException(`ResultSet ${resultSetId} is '${rs?.status ?? 'gone'}', not publishable`);
        }

        const conflicts = await this.runPublishGate(rs, tx);
        if (conflicts.length > 0) {
          throw new BadRequestException({ message: 'Publish gate failed', conflicts });
        }

        const previous = await tx.resultSet.findFirst({
          where: {
            termId: rs.termId, scopeType: rs.scopeType, scopeId: rs.scopeId,
            status: { in: [...RELEASED_RESULT_STATUSES] }, id: { not: rs.id }, deletedAt: null,
          },
        });
        if (previous) {
          const amendment = await tx.amendmentRequest.findFirst({ where: { resultSetId: previous.id, status: 'approved' } });
          if (!amendment) {
            throw new BadRequestException({
              code: 'AMENDMENT_REQUIRED',
              message: 'Released results can only be replaced through an approved amendment.',
            });
          }
          await tx.resultSet.updateMany({ where: { id: previous.id }, data: { status: 'archived' } });
          await tx.amendmentRequest.updateMany({
            where: { id: amendment.id },
            data: { status: 'applied', newResultSetId: rs.id },
          });
          await this.audit.recordInTx(tx, { entity: 'AmendmentRequest', entityId: amendment.id, action: 'post', newValues: { applied: true, newResultSetId: rs.id } });
        }

        await tx.resultSet.updateMany({
          where: { id: resultSetId },
          data: { status: 'published', publishedAt: new Date(), publishedById: this.tenant.userId ?? null },
        });
        await this.audit.recordInTx(tx, {
          entity: 'ResultSet',
          entityId: resultSetId,
          action: 'post',
          newValues: { action: 'publish', revision: rs.revision, supersedes: previous?.id ?? null },
        });
        await this.events.publishInTx(tx, EVENTS.SchoolResultsPublished, {
          organizationId,
          resultSetId,
          termId: rs.termId,
          revision: rs.revision,
        });
        if (previous) {
          await this.events.publishInTx(tx, EVENTS.SchoolResultsAmended, {
            organizationId,
            resultSetId,
            previousResultSetId: previous.id,
            revision: rs.revision,
          });
        }
        return tx.resultSet.findFirst({ where: { id: resultSetId } });
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  /** The all-or-nothing checks, returning structured conflicts (never a bare 400). */
  async runPublishGate(rs: any, db: any = this.prisma.client): Promise<PublishConflict[]> {
    const conflicts: PublishConflict[] = [];

    // 1. Roster frozen and present.
    const roster = rs.rosterId
      ? await db.academicRoster.findFirst({ where: { id: rs.rosterId }, include: { members: true } })
      : null;
    if (!roster) {
      conflicts.push({ code: 'NO_ROSTER', detail: 'result set has no roster' });
      return conflicts;
    }
    if (!roster.frozenAt) conflicts.push({ code: 'ROSTER_NOT_FROZEN', detail: `roster ${roster.id} is not frozen` });

    // 2. Coverage: every roster member has a term result with at least one subject.
    const termByStudent = new Map<string, any>(rs.termResults.map((t: any) => [t.studentProfileId, t]));
    const subjectRowsOf = new Map<string, number>();
    for (const r of rs.subjectResults ?? []) subjectRowsOf.set(r.studentProfileId, (subjectRowsOf.get(r.studentProfileId) ?? 0) + 1);
    for (const m of roster.members) {
      const t = termByStudent.get(m.studentProfileId);
      if (!t) {
        conflicts.push({ code: 'STUDENT_NOT_COVERED', studentProfileId: m.studentProfileId, detail: 'roster member has no computed result' });
      } else if (!subjectRowsOf.get(m.studentProfileId)) {
        conflicts.push({ code: 'NO_SUBJECT_RESULTS', studentProfileId: m.studentProfileId, detail: 'this learner has no subject result at all' });
      }
    }

    // 3. Every contributing summative mark is approved (or a terminal non-participation).
    //    Formative work never reaches a result, so it never blocks one (F03).
    const studentIds = roster.members.map((m: any) => m.studentProfileId);
    const contributing = await db.studentAssessment.findMany({
      // Same relation filter as buildInput — a soft-deleted assessment must not
      // be able to block a publish with a MARKS_NOT_APPROVED conflict.
      where: {
        studentProfileId: { in: studentIds },
        termId: rs.termId,
        assessment: { deletedAt: null, contribution: 'summative' },
      },
    });
    for (const sa of contributing) {
      const terminal = APPROVAL_FREE_PARTICIPATION.includes(sa.participation);
      if (sa.approvalStatus !== 'approved' && !terminal) {
        conflicts.push({ code: 'MARKS_NOT_APPROVED', studentProfileId: sa.studentProfileId, detail: `student assessment ${sa.id} is '${sa.approvalStatus}'` });
      }
      if (sa.approvedById && sa.enteredById && sa.approvedById === sa.enteredById) {
        conflicts.push({ code: 'SOD_VIOLATION', studentProfileId: sa.studentProfileId, detail: `assessment ${sa.id} approved by its enterer` });
      }
    }

    // 4. Checksums present (the compute recorded a reproducible snapshot).
    if (!rs.inputChecksum || !rs.outputChecksum) {
      conflicts.push({ code: 'MISSING_CHECKSUM', detail: 'result set is missing input/output checksums' });
    }

    // 5. Phase 5 — every contributing row has an OUTCOME. Blank is not zero.
    for (const sa of contributing) {
      if (sa.effectiveScore == null && !TERMINAL_PARTICIPATION.includes(sa.participation)) {
        conflicts.push({
          code: 'PARTICIPATION_UNRESOLVED',
          studentProfileId: sa.studentProfileId,
          detail: `student assessment ${sa.id} has no mark and no recorded absence or exemption`,
        });
      }
    }

    // 5b. ADR-031 D2 — the school's rule for absences and exemptions.
    const profile = await db.schoolProfile.findFirst({ select: { resultAbsencePolicy: true } });
    const absencePolicy = profile?.resultAbsencePolicy ?? 'ABSENT_AS_ZERO';
    if (absencePolicy !== 'ABSENT_AS_ZERO') {
      const blocking = absencePolicy === 'ALL_BLOCK' ? ['absent', 'exempt', 'excused'] : ['absent'];
      for (const sa of contributing) {
        if (blocking.includes(sa.participation)) {
          conflicts.push({
            code: sa.participation === 'absent' ? 'ABSENCE_UNRESOLVED' : 'EXEMPTION_NOT_ALLOWED',
            studentProfileId: sa.studentProfileId,
            detail: `school policy requires a real mark here, but student assessment ${sa.id} is '${sa.participation}'`,
          });
        }
      }
    }

    // 6. F02 — every required component has evidence. The kernel leaves a
    //    subject without a result when one is missing; this names it.
    for (const r of rs.subjectResults ?? []) {
      const breakdown = (r.componentBreakdown ?? []) as any[];
      const missing = breakdown.filter((c) => c.status === 'missing');
      if (missing.length) {
        conflicts.push({
          code: 'MISSING_EVIDENCE',
          studentProfileId: r.studentProfileId,
          subjectId: r.subjectId,
          detail: `no approved evidence for required ${missing.map((c) => `${c.kind} (${c.weight}%)`).join(', ')} work`,
        });
      } else if (r.finalPercent == null) {
        const allExempt = breakdown.length > 0 && breakdown.every((c) => c.status === 'exempt');
        if (!allExempt) {
          conflicts.push({ code: 'NO_SUBJECT_RESULT', studentProfileId: r.studentProfileId, subjectId: r.subjectId, detail: 'this subject has no result' });
        }
      }
    }

    // 6b. F02 — every subject the learner takes this term has a result row.
    //     Subjects come from the learner's course memberships, not from
    //     whichever assessments happen to exist.
    const term = await db.term.findFirst({ where: { id: rs.termId }, select: { endDate: true } });
    const memberships = studentIds.length
      ? await db.courseEnrollment.findMany({
          where: {
            status: 'ENROLLED',
            studentEnrollment: { studentProfileId: { in: studentIds } },
            courseOffering: { termId: rs.termId, subjectId: { not: null }, deletedAt: null },
            ...(term?.endDate ? { OR: [{ endDate: null }, { endDate: { gte: term.endDate } }] } : {}),
          },
          select: { studentEnrollment: { select: { studentProfileId: true } }, courseOffering: { select: { subjectId: true } } },
        })
      : [];
    const have = new Set((rs.subjectResults ?? []).map((r: any) => `${r.studentProfileId}:${r.subjectId}`));
    const expected = new Set<string>();
    for (const cm of memberships as any[]) {
      const key = `${cm.studentEnrollment.studentProfileId}:${cm.courseOffering.subjectId}`;
      if (expected.has(key)) continue;
      expected.add(key);
      if (!have.has(key)) {
        conflicts.push({
          code: 'SUBJECT_MISSING',
          studentProfileId: cm.studentEnrollment.studentProfileId,
          subjectId: cm.courseOffering.subjectId,
          detail: 'the learner takes this subject but it has no result',
        });
      }
    }

    // 7. Phase 5 — the weighting actually adds up, under a signed-off policy.
    const subjectIds = [...new Set((rs.subjectResults ?? []).map((r: any) => r.subjectId))] as string[];
    const sampleMember = roster.members[0];
    const programmeId = sampleMember
      ? (await this.programmeIdsFor(db, [sampleMember.studentProfileId], rs.termId)).get(sampleMember.studentProfileId)
      : undefined;
    for (const subjectId of subjectIds) {
      const policy: any = await this.policies.resolve({
        subjectId,
        classId: sampleMember?.classId ?? undefined,
        gradeLevelId: sampleMember?.gradeLevelId ?? undefined,
        programmeId: programmeId ?? undefined,
        termId: rs.termId,
      });
      if (!policy) {
        conflicts.push({ code: 'NO_ASSESSMENT_POLICY', subjectId, detail: 'no weighting policy applies to this subject' });
        continue;
      }
      const components = policy.components ?? [];
      const total = components.reduce((n: number, c: any) => n + Number(c.weight), 0);
      if (!components.length || Math.abs(total - 100) > 0.001) {
        conflicts.push({
          code: 'COMPONENT_WEIGHTS_INVALID',
          subjectId,
          detail: `the weighting components for this subject total ${total}%, not 100%`,
        });
      }
      if (!policy.publishedAt) {
        conflicts.push({ code: 'POLICY_NOT_PUBLISHED', subjectId, detail: 'this subject is scored under an unpublished draft policy' });
      }
    }

    // 8. Phase 5 — an exam paper still open for mark entry must not be published from.
    const assessmentIds = [...new Set(contributing.map((sa: any) => sa.assessmentId))] as string[];
    if (assessmentIds.length) {
      const examAssessments = await db.assessment.findMany({
        where: { id: { in: assessmentIds }, sourceType: 'exam_session', deletedAt: null },
        select: { id: true, sourceRef: true },
      });
      const scheduleIds = examAssessments.map((a: any) => a.sourceRef).filter(Boolean) as string[];
      const schedules = scheduleIds.length
        ? await db.examSchedule.findMany({
            where: { id: { in: scheduleIds } },
            include: { exam: { select: { id: true, name: true, lifecycleState: true } } },
          })
        : [];
      for (const schedule of schedules as any[]) {
        const state = schedule.exam?.lifecycleState;
        if (!schedule.marksLockedAt && !['results_ready', 'closed', 'archived'].includes(state)) {
          conflicts.push({
            code: 'EXAM_PAPER_UNLOCKED',
            detail: `${schedule.exam?.name ?? 'an examination'} is '${state}' and this paper is still open for mark entry`,
          });
        }
      }
    }

    // 9. F05 — the snapshot is still what today's approved evidence produces.
    //    A mark, exemption, weighting or scale changed since compute means the
    //    stored numbers are not the school's current answer.
    if (rs.inputChecksum) {
      try {
        const { input } = await this.run(db, roster, rs.termId);
        if (sha(input) !== rs.inputChecksum) {
          conflicts.push({
            code: 'STALE_RESULTS',
            detail: 'marks, exemptions, weighting or the grading scale changed after these results were computed — recompute before publishing',
          });
        }
      } catch (e: any) {
        conflicts.push({ code: 'RECOMPUTE_FAILED', detail: e?.response?.message ?? e?.message ?? 'the inputs can no longer be computed' });
      }
    }

    return conflicts;
  }

  // ── amendment ────────────────────────────────────────────────────────────
  async requestAmendment(dto: RequestAmendmentDto) {
    const organizationId = this.tenant.organizationId;
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: dto.resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${dto.resultSetId} not found`);
    if (!(RELEASED_RESULT_STATUSES as readonly string[]).includes(rs.status)) {
      throw new BadRequestException('Amendments only apply to a published result set (edit a draft directly)');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
      const open = await tx.amendmentRequest.findFirst({
        where: { resultSetId: dto.resultSetId, status: { in: ['requested', 'approved'] } },
      });
      if (open) throw new BadRequestException('An amendment for these results is already in progress.');
      const req = await tx.amendmentRequest.create({
        data: {
          organizationId,
          resultSetId: dto.resultSetId,
          reason: dto.reason,
          detail: (dto.detail as any) ?? {},
          requestedById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, { entity: 'AmendmentRequest', entityId: req.id, action: 'create', newValues: { resultSetId: dto.resultSetId, reason: dto.reason } });
      return req;
    });
  }

  /**
   * Approve an amendment and compute its replacement revision. The released
   * set stays authoritative until the replacement is published (F04): if the
   * recomputation fails, nothing a parent sees has changed and the approved
   * amendment can simply be computed again.
   */
  async approveAmendment(amendmentId: string): Promise<ResultSet> {
    const amendment = await this.prisma.client.amendmentRequest.findFirst({ where: { id: amendmentId } });
    if (!amendment) throw new NotFoundException(`AmendmentRequest ${amendmentId} not found`);
    if (!['requested', 'approved'].includes(amendment.status)) throw new BadRequestException(`Amendment is '${amendment.status}'`);
    if (amendment.status === 'requested' && amendment.requestedById && amendment.requestedById === this.tenant.userId) {
      throw new BadRequestException('You requested this amendment and cannot approve it (segregation of duty).');
    }
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: amendment.resultSetId } });
    if (!rs) throw new NotFoundException('Result set gone');

    if (amendment.status === 'requested') {
      await this.prisma.client.$transaction(async (tx: any) => {
        await tx.amendmentRequest.updateMany({
          where: { id: amendmentId, status: 'requested' },
          data: { status: 'approved', reviewedById: this.tenant.userId ?? null },
        });
        await this.audit.recordInTx(tx, { entity: 'AmendmentRequest', entityId: amendmentId, action: 'approve', newValues: { resultSetId: rs.id } });
      });
    }

    return this.compute({ termId: rs.termId, scopeType: rs.scopeType, scopeId: rs.scopeId ?? undefined, rosterId: rs.rosterId ?? '' });
  }

  /**
   * Readiness report for a result set: the same all-or-nothing checks the publish
   * gate runs, returned as a checklist instead of throwing. `ready` is true only
   * when there are zero conflicts.
   */
  async readiness(resultSetId: string): Promise<{
    ready: boolean;
    conflicts: PublishConflict[];
    summary: {
      rosterFrozen: boolean;
      studentsCovered: number;
      studentsExpected: number;
      marksApproved: number;
      marksTotal: number;
      sodViolations: number;
      hasChecksums: boolean;
      participationUnresolved: number;
      weightingValid: boolean;
      examPapersLocked: boolean;
      evidenceComplete: boolean;
      upToDate: boolean;
    };
  }> {
    // termResults + subjectResults are REQUIRED: the gate reads both.
    const rs = await this.prisma.client.resultSet.findFirst({
      where: { id: resultSetId },
      include: { termResults: true, subjectResults: true },
    });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);

    const conflicts = await this.runPublishGate(rs);

    const roster = rs.rosterId
      ? await this.prisma.client.academicRoster.findFirst({
          where: { id: rs.rosterId },
          include: { members: true },
        })
      : null;

    const studentIds = (roster?.members ?? []).map((m: any) => m.studentProfileId);
    const contributing = studentIds.length
      ? await this.prisma.client.studentAssessment.findMany({
          where: { studentProfileId: { in: studentIds }, termId: rs.termId, assessment: { deletedAt: null, contribution: 'summative' } },
        })
      : [];

    const approved = contributing.filter(
      (sa: any) => sa.approvalStatus === 'approved' || APPROVAL_FREE_PARTICIPATION.includes(sa.participation),
    ).length;
    const sod = contributing.filter(
      (sa: any) => sa.approvedById && sa.enteredById && sa.approvedById === sa.enteredById,
    ).length;
    const unresolved = contributing.filter(
      (sa: any) => sa.effectiveScore == null && !TERMINAL_PARTICIPATION.includes(sa.participation),
    ).length;
    const weightCodes = ['COMPONENT_WEIGHTS_INVALID', 'NO_ASSESSMENT_POLICY', 'POLICY_NOT_PUBLISHED'];
    const evidenceCodes = ['MISSING_EVIDENCE', 'NO_SUBJECT_RESULT', 'SUBJECT_MISSING', 'NO_SUBJECT_RESULTS', 'ABSENCE_UNRESOLVED', 'EXEMPTION_NOT_ALLOWED'];

    return {
      ready: conflicts.length === 0,
      conflicts,
      summary: {
        rosterFrozen: !!roster?.frozenAt,
        studentsCovered: rs.termResults?.length ?? 0,
        studentsExpected: roster?.members?.length ?? 0,
        marksApproved: approved,
        marksTotal: contributing.length,
        sodViolations: sod,
        hasChecksums: !!rs.inputChecksum && !!rs.outputChecksum,
        participationUnresolved: unresolved,
        weightingValid: !conflicts.some((c) => weightCodes.includes(c.code)),
        examPapersLocked: !conflicts.some((c) => c.code === 'EXAM_PAPER_UNLOCKED'),
        evidenceComplete: !conflicts.some((c) => evidenceCodes.includes(c.code)),
        upToDate: !conflicts.some((c) => c.code === 'STALE_RESULTS' || c.code === 'RECOMPUTE_FAILED'),
      },
    };
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  async findResultSet(id: string): Promise<ResultSet> {
    const rs = await this.prisma.client.resultSet.findFirst({
      where: { id },
      include: { termResults: true, subjectResults: true },
    });
    if (!rs) throw new NotFoundException(`ResultSet ${id} not found`);
    return rs;
  }

  /** The learner's released (published or locked) result for a term (F16). */
  async latestPublished(termId: string, studentProfileId: string) {
    const term = await this.prisma.client.studentTermResult.findFirst({
      where: { termId, studentProfileId, resultSet: releasedResultSetWhere() },
      include: { resultSet: true },
      orderBy: { resultSet: { revision: 'desc' } },
    });
    if (!term) return null;
    const subjects = await this.prisma.client.studentSubjectResult.findMany({
      where: { resultSetId: term.resultSetId, studentProfileId },
    });
    return { term, subjects, resultSet: term.resultSet };
  }

  // ── data loading (StudentAssessment → pure input) ───────────────────────────
  /**
   * How this cohort is reported: which grading system, and whether it is ranked.
   *
   * The authority is the programme's versioned `config`. Where a school has not
   * configured it, the programme's stage supplies a default — pre-primary is
   * reported in descriptors and is not ranked. Everything else falls back to
   * the school profile.
   *
   * F14: a roster whose learners are under programmes that report differently
   * (nursery descriptors beside primary grades) has no single answer and is
   * refused, rather than quietly reported the school-wide way.
   */
  private async resolveReporting(db: any, roster: any, termId: string): Promise<Reporting> {
    const profile = await db.schoolProfile.findFirst({ where: {} });
    const schoolSystem = (profile?.gradingSystem ?? 'UCE') as string;
    const byAggregate = (system: string): ResultInput['rankOn'] =>
      ['PLE', 'UCE', 'UACE'].includes(system) ? 'aggregate' : 'gpa';
    const reportingOf = (programme: any | null): Reporting => {
      const config = (programme?.config ?? {}) as { gradingSystem?: string; rankOn?: string };
      const stageDefault = programme?.stage === 'PRE_PRIMARY';
      const gradingSystem = config.gradingSystem ?? (stageDefault ? 'ECD' : schoolSystem);
      const rankOn = (config.rankOn as ResultInput['rankOn'] | undefined)
        ?? (stageDefault ? 'none' : byAggregate(gradingSystem));
      return { gradingSystem, rankOn };
    };

    const programmes = await this.programmesFor(db, roster, termId);
    if (programmes.length <= 1) return reportingOf(programmes[0] ?? null);
    const distinct = new Map(programmes.map((p) => [JSON.stringify(reportingOf(p)), reportingOf(p)]));
    if (distinct.size > 1) {
      throw new BadRequestException({
        code: 'MIXED_REPORTING',
        message: 'This list mixes learners whose programmes are reported differently (for example nursery and primary). Compute each class separately.',
      });
    }
    return [...distinct.values()][0];
  }

  /**
   * The programmes this roster's learners are enrolled under for the term's
   * academic year — the class cohort's where there is one, else the members'
   * own enrollments for THAT year (a pupil promoted since keeps last year's
   * programme for last year's results).
   */
  private async programmesFor(db: any, roster: any, termId: string): Promise<any[]> {
    const term = await db.term.findFirst({ where: { id: termId }, select: { academicYearId: true } });
    if (!term) return [];
    if (roster.classId) {
      const cohort = await db.classCohort.findFirst({
        where: { classId: roster.classId, academicYearId: term.academicYearId, deletedAt: null },
        select: { programme: { select: { id: true, stage: true, config: true } } },
      });
      if (cohort?.programme) return [cohort.programme];
    }
    const studentProfileIds = [
      ...new Set((roster.members ?? []).map((m: any) => m.studentProfileId).filter(Boolean)),
    ] as string[];
    if (!studentProfileIds.length) return [];
    const enrollments = await db.studentEnrollment.findMany({
      where: { studentProfileId: { in: studentProfileIds }, academicYearId: term.academicYearId },
      select: { programme: { select: { id: true, stage: true, config: true } } },
      distinct: ['programmeId'],
    });
    return enrollments.map((e: any) => e.programme).filter(Boolean);
  }

  /** Each learner's programme for the term's year (ADR-031 D5 policy scope). */
  private async programmeIdsFor(db: any, studentProfileIds: string[], termId: string): Promise<Map<string, string>> {
    const term = await db.term.findFirst({ where: { id: termId }, select: { academicYearId: true } });
    if (!term || !studentProfileIds.length) return new Map();
    const rows = await db.studentEnrollment.findMany({
      where: { studentProfileId: { in: studentProfileIds }, academicYearId: term.academicYearId },
      select: { studentProfileId: true, programmeId: true },
    });
    return new Map(rows.map((r: any) => [r.studentProfileId, r.programmeId]));
  }

  /**
   * The kernel's input from each member's evidence. Only APPROVED marks (or a
   * participation outcome, which has nothing to approve) are evidence (F05);
   * an unapproved mark is not yet a mark. Assessments are ordered by when they
   * happened, with fixed tie-breakers, so `last` is reproducible (F21). Every
   * list is sorted, so the same evidence always hashes to the same checksum.
   */
  private async buildInput(db: any, roster: any, termId: string): Promise<{ students: StudentInput[]; contributing: any[] }> {
    const studentIds = roster.members.map((m: any) => m.studentProfileId);
    const rows = await db.studentAssessment.findMany({
      // Soft-deleting an Assessment does NOT cascade to its children, so the
      // relation filter is what makes a deleted assessment stop counting.
      where: {
        studentProfileId: { in: studentIds },
        termId,
        assessment: { deletedAt: null },
        OR: [{ approvalStatus: 'approved' }, { participation: { in: APPROVAL_FREE_PARTICIPATION } }],
      },
      include: { assessment: { include: { component: true } } },
    });

    const when = (a: any) => new Date(a.dueAt ?? a.closeAt ?? a.openAt ?? a.createdAt).getTime();
    const chronology = [...new Map(rows.map((r: any) => [r.assessment.id, r.assessment])).values()].sort(
      (a: any, b: any) =>
        when(a) - when(b) ||
        (a.sequence ?? 0) - (b.sequence ?? 0) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        String(a.id).localeCompare(String(b.id)),
    );
    const orderOf = new Map(chronology.map((a: any, i: number) => [a.id, i]));

    // Subject roles drive the aggregate: PLE core, UCE compulsory, UACE principal.
    const subjectIds = [...new Set(rows.map((r: any) => r.assessment.subjectId).filter(Boolean))];
    const subjectRows = subjectIds.length
      ? await db.subject.findMany({ where: { id: { in: subjectIds as string[] } } })
      : [];
    const subjectMeta = new Map(subjectRows.map((x: any) => [x.id, x]));
    const system = (await db.schoolProfile.findFirst({ select: { gradingSystem: true } }))?.gradingSystem ?? 'UCE';
    const programmeOf = await this.programmeIdsFor(db, studentIds, termId);

    const students: StudentInput[] = [];
    const sortedMembers = [...roster.members].sort((a: any, b: any) => String(a.studentProfileId).localeCompare(String(b.studentProfileId)));
    for (const m of sortedMembers) {
      const mine = rows.filter((r: any) => r.studentProfileId === m.studentProfileId);
      const bySubject = new Map<string, any[]>();
      for (const r of mine) {
        const subjectId = r.assessment.subjectId;
        if (!subjectId) continue; // Non-subject evidence is not a subject-result column.
        if (!bySubject.has(subjectId)) bySubject.set(subjectId, []);
        bySubject.get(subjectId)!.push(r);
      }

      const subjects: SubjectInput[] = [];
      for (const subjectId of [...bySubject.keys()].sort()) {
        const saRows = bySubject.get(subjectId)!;
        const policy = await this.policies.resolve({
          subjectId,
          classId: m.classId,
          gradeLevelId: m.gradeLevelId,
          programmeId: programmeOf.get(m.studentProfileId) ?? null,
          termId,
        });
        const assessments: AssessmentDatum[] = saRows
          .map((r: any) => ({
            componentId: r.assessment.componentId,
            kind: kindOf(r.assessment),
            effectiveScore: r.effectiveScore == null ? null : String(r.effectiveScore),
            maxScore: String(r.maxScore),
            participation: r.participation,
            order: orderOf.get(r.assessment.id) ?? 0,
            formative: r.assessment.contribution === 'formative',
          }))
          .sort((a: AssessmentDatum, b: AssessmentDatum) => (a.order ?? 0) - (b.order ?? 0));
        const meta: any = subjectMeta.get(subjectId);
        const subjectName = meta?.name ?? '';
        const subjectCode = meta?.code ?? undefined;
        subjects.push({
          subjectId,
          isCompulsory: isCompulsorySubject(subjectName),
          isPrincipal: !isSubsidiarySubject(subjectName, subjectCode, system),
          // `Subject.isCore` defaults to true for everything, so the national
          // paper identity has to agree before a subject counts toward a PLE
          // aggregate — otherwise every subject a school teaches would.
          isCore: (meta?.isCore ?? true) && isPleCoreSubject(subjectName, subjectCode),
          passMark: policy?.passMark != null ? String(policy.passMark) : 50,
          components: (policy?.components ?? [])
            .slice()
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)))
            .map((c: any) => ({
              id: c.id,
              kind: c.kind,
              weight: String(c.weight),
              aggregation: c.aggregation,
              bestN: c.bestN,
              countsAbsentAsZero: c.countsAbsentAsZero,
            })),
          assessments,
        });
      }
      students.push({
        studentProfileId: m.studentProfileId,
        classId: m.classId,
        sectionId: m.sectionId,
        gradeLevelId: m.gradeLevelId,
        termId,
        subjects,
      });
    }
    return { students, contributing: rows };
  }
}
