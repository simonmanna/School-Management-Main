import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ResultSet } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { AssessmentPolicyService } from './assessment-config.service';
import { resolveBands } from './grade-bands';
import {
  computeResultSet,
  type AssessmentDatum,
  type ResultInput,
  type StudentInput,
  type SubjectInput,
} from './result-computation';
import type { ComputeResultsDto, RequestAmendmentDto } from './dto.types';

interface PublishConflict {
  code: string;
  studentProfileId?: string;
  subjectId?: string;
  detail: string;
}

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/**
 * The result spine's engine (A3). `compute` projects a frozen roster's approved
 * marks into an immutable, versioned ResultSet under a snapshotted policy;
 * `publish` runs the all-or-nothing gate that lets a computed set become the
 * authoritative record. Corrections never mutate — they go request → approve →
 * recompute → new revision, archiving the old.
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

    const profile = await this.prisma.client.schoolProfile.findFirst({ where: {} });
    const gradingSystem = (profile?.gradingSystem ?? 'UCE') as string;
    const bands = await resolveBands(this.prisma.client, gradingSystem);

    const scopeType = dto.scopeType ?? 'class';
    const scopeId = dto.scopeId ?? roster.classId ?? null;

    // Build the pure input from each member's approved-or-terminal marks.
    const { students, contributing } = await this.buildInput(roster, dto.termId);
    const input: ResultInput = {
      gradingSystem: gradingSystem as ResultInput['gradingSystem'],
      bands,
      roundingMode: 'half_up',
      decimalPlaces: 2,
      rankOn: gradingSystem === 'UCE' || gradingSystem === 'UACE' ? 'aggregate' : 'gpa',
      students,
    };
    const inputChecksum = sha(input);
    const output = computeResultSet(input);
    const outputChecksum = sha(output);

    return this.prisma.client.$transaction(async (tx: any) => {
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

      // Supersede any existing live result set for this scope+term.
      const live = await tx.resultSet.findFirst({
        where: { termId: dto.termId, scopeType, scopeId, status: { not: 'archived' }, deletedAt: null },
      });
      let revision = 1;
      if (live) {
        revision = live.revision + 1;
        if (['published', 'locked'].includes(live.status)) {
          await tx.resultSet.updateMany({ where: { id: live.id }, data: { status: 'archived' } });
        } else {
          await tx.resultSet.deleteMany({ where: { id: live.id } }); // draft/computed → discard
        }
      }

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
          gradingSystem,
          gradingScaleSnapshot: bands as any,
          rankingPolicySnapshot: { rankOn: input.rankOn } as any,
          inputChecksum,
          outputChecksum,
          studentCount: output.students.length,
        },
      });

      for (const s of output.students) {
        const member = roster.members.find((m: any) => m.studentProfileId === s.studentProfileId);
        for (const sub of s.subjects) {
          await tx.studentSubjectResult.create({
            data: {
              organizationId,
              resultSetId: resultSet.id,
              studentProfileId: s.studentProfileId,
              subjectId: sub.subjectId,
              classId: member?.classId ?? null,
              sectionId: member?.sectionId ?? null,
              gradeLevelId: member?.gradeLevelId ?? null,
              termId: dto.termId,
              caScore: sub.caScore ?? null,
              examScore: sub.examScore ?? null,
              finalPercent: sub.finalPercent ?? null,
              grade: sub.grade,
              gradePoint: sub.gradePoint ?? null,
              points: sub.points ?? null,
              subjectRank: sub.subjectRank ?? null,
              componentBreakdown: sub.componentBreakdown as any,
            },
          });
        }
        await tx.studentTermResult.create({
          data: {
            organizationId,
            resultSetId: resultSet.id,
            studentProfileId: s.studentProfileId,
            classId: member?.classId ?? null,
            sectionId: member?.sectionId ?? null,
            gradeLevelId: member?.gradeLevelId ?? null,
            termId: dto.termId,
            gpa: s.term.gpa ?? null,
            aggregate: s.term.aggregate ?? null,
            division: s.term.division ?? null,
            meanPercent: s.term.meanPercent ?? null,
            classRank: s.term.classRank ?? null,
            subjectsCount: s.term.subjectsCount,
            eligible: s.term.eligible,
            promotionRecommendation: s.term.promotionRecommendation,
          },
        });
      }

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
      this.events.publish(EVENTS.SchoolResultsComputed, {
        organizationId,
        resultSetId: resultSet.id,
        termId: dto.termId,
        revision,
        studentCount: output.students.length,
      });
      return tx.resultSet.findFirst({ where: { id: resultSet.id } });
    });
  }

  // ── publish gate ───────────────────────────────────────────────────────────
  async publish(resultSetId: string): Promise<ResultSet> {
    const organizationId = this.tenant.organizationId;
    const rs = await this.prisma.client.resultSet.findFirst({
      where: { id: resultSetId },
      include: { termResults: true, subjectResults: true },
    });
    if (!rs) throw new NotFoundException(`ResultSet ${resultSetId} not found`);
    if (!['computed', 'approved'].includes(rs.status)) {
      throw new BadRequestException(`ResultSet ${resultSetId} is '${rs.status}', not publishable`);
    }

    const conflicts = await this.runPublishGate(rs);
    if (conflicts.length > 0) {
      throw new BadRequestException({ message: 'Publish gate failed', conflicts });
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.resultSet.updateMany({
        where: { id: resultSetId },
        data: { status: 'published', publishedAt: new Date(), publishedById: this.tenant.userId ?? null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ResultSet',
        entityId: resultSetId,
        action: 'post',
        newValues: { action: 'publish', revision: rs.revision },
      });
      this.events.publish(EVENTS.SchoolResultsPublished, {
        organizationId,
        resultSetId,
        termId: rs.termId,
        revision: rs.revision,
      });
      return tx.resultSet.findFirst({ where: { id: resultSetId } });
    });
  }

  /** The all-or-nothing checks, returning structured conflicts (never a bare 400). */
  async runPublishGate(rs: any): Promise<PublishConflict[]> {
    const conflicts: PublishConflict[] = [];

    // 1. Roster frozen and present.
    const roster = rs.rosterId
      ? await this.prisma.client.academicRoster.findFirst({ where: { id: rs.rosterId }, include: { members: true } })
      : null;
    if (!roster) {
      conflicts.push({ code: 'NO_ROSTER', detail: 'result set has no roster' });
      return conflicts;
    }
    if (!roster.frozenAt) conflicts.push({ code: 'ROSTER_NOT_FROZEN', detail: `roster ${roster.id} is not frozen` });

    // 2. Coverage: every roster member has a term result.
    const covered = new Set(rs.termResults.map((t: any) => t.studentProfileId));
    for (const m of roster.members) {
      if (!covered.has(m.studentProfileId)) {
        conflicts.push({ code: 'STUDENT_NOT_COVERED', studentProfileId: m.studentProfileId, detail: 'roster member has no computed result' });
      }
    }

    // 3. Every contributing mark is approved (or a terminal non-participation).
    const studentIds = roster.members.map((m: any) => m.studentProfileId);
    const contributing = await this.prisma.client.studentAssessment.findMany({
      where: { studentProfileId: { in: studentIds }, termId: rs.termId },
    });
    for (const sa of contributing) {
      const terminal = ['exempt', 'excused', 'absent', 'malpractice'].includes(sa.participation);
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

    return conflicts;
  }

  // ── amendment ────────────────────────────────────────────────────────────
  async requestAmendment(dto: RequestAmendmentDto) {
    const organizationId = this.tenant.organizationId;
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: dto.resultSetId } });
    if (!rs) throw new NotFoundException(`ResultSet ${dto.resultSetId} not found`);
    if (!['published', 'locked'].includes(rs.status)) {
      throw new BadRequestException('Amendments only apply to a published result set (edit a draft directly)');
    }
    return this.prisma.client.$transaction(async (tx: any) => {
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

  /** Approve an amendment → recompute → new revision; the old is archived. */
  async approveAmendment(amendmentId: string): Promise<ResultSet> {
    const amendment = await this.prisma.client.amendmentRequest.findFirst({ where: { id: amendmentId } });
    if (!amendment) throw new NotFoundException(`AmendmentRequest ${amendmentId} not found`);
    if (amendment.status !== 'requested') throw new BadRequestException(`Amendment is '${amendment.status}'`);
    const rs = await this.prisma.client.resultSet.findFirst({ where: { id: amendment.resultSetId } });
    if (!rs) throw new NotFoundException('Result set gone');

    // Recompute produces a new revision (archiving the old inside compute()).
    const next = await this.compute({ termId: rs.termId, scopeType: rs.scopeType, scopeId: rs.scopeId ?? undefined, rosterId: rs.rosterId ?? '' });

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.amendmentRequest.updateMany({
        where: { id: amendmentId },
        data: { status: 'applied', reviewedById: this.tenant.userId ?? null, newResultSetId: next.id },
      });
      await this.audit.recordInTx(tx, { entity: 'AmendmentRequest', entityId: amendmentId, action: 'approve', newValues: { newResultSetId: next.id } });
    });
    this.events.publish(EVENTS.SchoolResultsAmended, {
      organizationId: this.tenant.organizationId,
      resultSetId: next.id,
      previousResultSetId: rs.id,
      revision: next.revision,
    });
    return next;
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

  async latestPublished(termId: string, studentProfileId: string) {
    const term = await this.prisma.client.studentTermResult.findFirst({
      where: { termId, studentProfileId, resultSet: { status: 'published' } },
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
  private async buildInput(roster: any, termId: string): Promise<{ students: StudentInput[]; contributing: any[] }> {
    const studentIds = roster.members.map((m: any) => m.studentProfileId);
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { studentProfileId: { in: studentIds }, termId },
      include: { assessment: { include: { component: true } } },
    });

    const students: StudentInput[] = [];
    for (const m of roster.members) {
      const mine = rows.filter((r: any) => r.studentProfileId === m.studentProfileId);
      const bySubject = new Map<string, any[]>();
      for (const r of mine) {
        const subjectId = r.assessment.subjectId;
        if (!bySubject.has(subjectId)) bySubject.set(subjectId, []);
        bySubject.get(subjectId)!.push(r);
      }

      const subjects: SubjectInput[] = [];
      for (const [subjectId, saRows] of bySubject) {
        const policy = await this.policies.resolve({
          subjectId,
          classId: m.classId,
          gradeLevelId: m.gradeLevelId,
          termId,
        });
        const assessments: AssessmentDatum[] = saRows.map((r: any, i: number) => ({
          componentId: r.assessment.componentId,
          kind: r.assessment.component?.kind ?? (r.assessment.sourceType === 'exam_session' ? 'exam' : 'cat'),
          effectiveScore: r.effectiveScore,
          maxScore: r.maxScore,
          participation: r.participation,
          order: i,
        }));
        subjects.push({
          subjectId,
          passMark: policy?.passMark ?? 50,
          components: (policy?.components ?? []).map((c: any) => ({
            id: c.id,
            kind: c.kind,
            weight: c.weight,
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
