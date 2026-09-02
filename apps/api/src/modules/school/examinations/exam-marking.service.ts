import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { MarkingService } from '../assessment/marking.service';
import { ExamOperationsService } from './exam-operations.service';
import type {
  AllocateScriptsDto,
  DrawModerationSampleDto,
  RecordModerationDto,
  ReconcileScriptDto,
  SubmitScriptMarkDto,
} from './exam-operations.dto';

const D = Prisma.Decimal;

/** ScriptAllocation.role → the MarkEntry round it becomes at reconciliation. */
const ROUND_FOR_ROLE: Record<string, 'first' | 'second_blind' | 'reconciliation'> = {
  first: 'first',
  second: 'second_blind',
  reconciliation: 'reconciliation',
};

/**
 * Marking an exam paper: script allocation, blind/double marking, reconciliation
 * and moderation samples.
 *
 * Marker scores live on `ScriptAllocation` until the script is reconciled.
 * That is deliberate: under blind marking the first read must not become the
 * visible mark, and the canonical ledger should record an agreed mark, not a
 * work-in-progress one. Reconciliation writes every round into `MarkEntry`
 * through `MarkingService.postMark` — still the only writer of a score.
 */
@Injectable()
export class ExamMarkingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly marking: MarkingService,
    private readonly ops: ExamOperationsService,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org(): string { return this.tenant.organizationId; }
  private get perms(): string[] { return this.tenant.store?.permissions ?? []; }

  private mayAdminister(): boolean {
    return this.perms.some((p) => [
      '*', PERMISSIONS.school.allocateScripts, PERMISSIONS.school.moderateMarks, PERMISSIONS.school.runExamOperations,
    ].includes(p));
  }

  /**
   * The canonical assessment a paper's marks land on — and proof it can receive
   * them. A draft assessment has no frozen learner rows, so posting to it would
   * fail inside the mark writer with a message about rosters rather than about
   * this paper.
   */
  private async markableAssessment(tx: any, examScheduleId: string) {
    const assessment = await tx.assessment.findFirst({
      where: { sourceType: 'exam_session', sourceRef: examScheduleId, deletedAt: null },
    });
    if (!assessment) {
      throw new BadRequestException('This paper has no canonical assessment yet. Create it from the assessment board first.');
    }
    if (!assessment.rosterId || ['draft', 'scheduled', 'archived'].includes(assessment.status)) {
      throw new BadRequestException(
        `This paper's assessment is '${assessment.status}'. Publish it to its frozen roster on the assessment board before marking.`,
      );
    }
    return assessment;
  }

  /** A short, stable, name-free identifier for a candidate's script. */
  private codeFor(examScheduleId: string, studentProfileId: string): string {
    return createHash('sha256')
      .update(`${examScheduleId}:${studentProfileId}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();
  }

  // ── allocation ─────────────────────────────────────────────────────────────

  /**
   * Hand out the scripts for a paper. Only candidates who actually sat it get a
   * script: an absentee has no paper to mark, and inventing an allocation for
   * them is how an absence quietly becomes a zero.
   */
  async allocate(examScheduleId: string, dto: AllocateScriptsDto) {
    if (!dto.markerIds?.length) throw new BadRequestException('Choose at least one marker');
    const unique = [...new Set(dto.markerIds)];
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.examSchedule.findFirst({ where: { id: examScheduleId }, include: { exam: true } });
      if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);
      if (paper.marksLockedAt) throw new BadRequestException('This paper is locked; scripts can no longer be allocated');
      if (!['in_progress', 'marking', 'moderation'].includes(paper.exam.lifecycleState)) {
        throw new BadRequestException('Scripts are allocated once the examination is under way');
      }

      const mode = paper.markingMode as 'single' | 'double' | 'blind_double';
      const needed = mode === 'single' ? 1 : 2;
      if (unique.length < needed) {
        throw new BadRequestException(
          `${mode === 'single' ? 'Single' : 'Double'} marking needs at least ${needed} marker(s); ${unique.length} chosen`,
        );
      }

      await this.markableAssessment(tx, examScheduleId);

      const sat = await tx.examAttendance.findMany({
        where: { examScheduleId, status: { in: ['present', 'late'] } },
        orderBy: { studentProfileId: 'asc' },
      });
      if (!sat.length) throw new BadRequestException('No attendance has been recorded for this paper yet');

      const roles: Array<'first' | 'second'> = needed === 1 ? ['first'] : ['first', 'second'];
      let created = 0;
      let skipped = 0;
      for (const [i, row] of sat.entries()) {
        const code = this.codeFor(examScheduleId, row.studentProfileId);
        // Round-robin the first read, and shift the second by one so the same
        // marker never gets both reads of one script. The DB trigger enforces
        // that independently; this is what makes the spread even.
        const markerFor = (role: string) => unique[(i + (role === 'second' ? 1 : 0)) % unique.length];
        for (const role of roles) {
          const existing = await tx.scriptAllocation.findFirst({
            where: { examScheduleId, studentProfileId: row.studentProfileId, role },
          });
          if (existing) { skipped += 1; continue; }
          await tx.scriptAllocation.create({
            data: {
              organizationId: this.org,
              examScheduleId,
              studentProfileId: row.studentProfileId,
              anonymousCode: code,
              markerId: markerFor(role),
              role,
              maxScore: paper.maxMarks,
              allocatedById: this.tenant.userId ?? null,
            },
          });
          created += 1;
        }
        if (!row.scriptNumber) {
          await tx.examAttendance.updateMany({ where: { id: row.id }, data: { scriptNumber: code } });
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'ScriptAllocation', entityId: examScheduleId, action: 'create',
        newValues: { examScheduleId, markingMode: mode, markers: unique.length, created, skipped },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolScriptsAllocated, {
        organizationId: this.org, examId: paper.examId, examScheduleId, markingMode: mode, created,
      });
      return { examScheduleId, markingMode: mode, created, skipped, scripts: sat.length };
    });
  }

  /** Void every outstanding allocation for a paper, so it can be re-allocated. */
  async voidAllocations(examScheduleId: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Voiding an allocation needs a reason');
    return this.db.$transaction(async (tx: any) => {
      const reconciled = await tx.scriptAllocation.count({ where: { examScheduleId, status: 'reconciled' } });
      if (reconciled > 0) {
        throw new BadRequestException(`${reconciled} script(s) already carry an agreed mark; those cannot be voided`);
      }
      const res = await tx.scriptAllocation.updateMany({
        where: { examScheduleId, status: { in: ['allocated', 'in_progress', 'submitted'] } },
        data: { status: 'void' },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ScriptAllocation', entityId: examScheduleId, action: 'cancel',
        newValues: { examScheduleId, voided: res.count, reason },
      });
      return { examScheduleId, voided: res.count };
    });
  }

  // ── marking ────────────────────────────────────────────────────────────────

  /**
   * The marker's own worklist. Under blind marking it carries the anonymous code
   * and nothing else identifying — no name, no admission number, and no sight of
   * the other marker's score.
   */
  async worklist(examScheduleId: string, markerId?: string) {
    const paper = await this.db.examSchedule.findFirst({
      where: { id: examScheduleId },
      include: { subject: { select: { name: true } }, schoolClass: { select: { name: true } }, exam: true },
    });
    if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);

    const admin = this.mayAdminister();
    const me = this.tenant.userId ?? '';
    const target = admin ? (markerId ?? undefined) : me;
    if (!admin && !me) throw new ForbiddenException('Sign in to see your marking worklist');

    const allocations = await this.db.scriptAllocation.findMany({
      where: { examScheduleId, status: { not: 'void' }, ...(target ? { markerId: target } : {}) },
      orderBy: [{ role: 'asc' }, { anonymousCode: 'asc' }],
    });

    const blind = paper.markingMode === 'blind_double';
    const names = blind && !admin ? new Map() : await this.ops.nameMap(allocations.map((a: any) => a.studentProfileId));

    return {
      paper: {
        id: paper.id, examId: paper.examId, examName: paper.exam.name,
        subjectName: paper.subject?.name ?? null, className: paper.schoolClass?.name ?? null,
        maxMarks: paper.maxMarks, markingMode: paper.markingMode,
        markToleranceMarks: paper.markToleranceMarks, marksLockedAt: paper.marksLockedAt,
      },
      blind,
      rows: allocations.map((a: any) => ({
        id: a.id,
        anonymousCode: a.anonymousCode,
        role: a.role,
        status: a.status,
        markerId: admin ? a.markerId : undefined,
        score: a.score,
        maxScore: a.maxScore,
        comment: a.comment,
        submittedAt: a.submittedAt,
        version: a.version,
        // Identity is withheld under blind marking; an administrator sees it.
        studentProfileId: blind && !admin ? undefined : a.studentProfileId,
        studentName: blind && !admin ? undefined : names.get(a.studentProfileId)?.name ?? null,
      })),
    };
  }

  /** Record one marker's score for one script. A marker writes only their own row. */
  async submitScriptMark(allocationId: string, dto: SubmitScriptMarkDto) {
    return this.db.$transaction(async (tx: any) => {
      const alloc = await tx.scriptAllocation.findFirst({ where: { id: allocationId } });
      if (!alloc) throw new NotFoundException(`Script allocation ${allocationId} not found`);
      if (alloc.status === 'void') throw new BadRequestException('This allocation was voided');
      if (alloc.status === 'reconciled') throw new BadRequestException('This script already carries an agreed mark');

      const me = this.tenant.userId ?? '';
      if (alloc.markerId !== me && !this.mayAdminister()) {
        throw new ForbiddenException('You may only mark the scripts allocated to you');
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== alloc.version) {
        throw new ConflictException({
          code: 'SCRIPT_VERSION_CONFLICT',
          message: 'This script was marked by someone else while you were working',
          currentVersion: alloc.version,
          currentScore: alloc.score,
        });
      }
      const paper = await tx.examSchedule.findFirst({ where: { id: alloc.examScheduleId } });
      if (paper?.marksLockedAt) throw new BadRequestException('This paper is locked');

      const max = new D(alloc.maxScore);
      const score = dto.score === null || dto.score === undefined ? null : new D(dto.score);
      if (score && (score.lt(0) || score.gt(max))) {
        throw new BadRequestException(`A mark must be between 0 and ${max.toString()}`);
      }

      await tx.scriptAllocation.updateMany({
        where: { id: allocationId, version: alloc.version },
        data: {
          score,
          comment: dto.comment ?? alloc.comment,
          status: score === null ? 'in_progress' : 'submitted',
          submittedAt: score === null ? null : new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ScriptAllocation', entityId: allocationId, action: 'update',
        oldValues: { score: alloc.score, status: alloc.status },
        newValues: { score: score?.toString() ?? null, role: alloc.role, anonymousCode: alloc.anonymousCode },
      });
      return tx.scriptAllocation.findFirst({ where: { id: allocationId } });
    });
  }

  // ── reconciliation ─────────────────────────────────────────────────────────

  /** What every script on this paper currently looks like, for the reconciler. */
  async reconciliationBoard(examScheduleId: string) {
    const paper = await this.db.examSchedule.findFirst({
      where: { id: examScheduleId },
      include: { subject: { select: { name: true } }, schoolClass: { select: { name: true } }, exam: true },
    });
    if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);

    const allocations = await this.db.scriptAllocation.findMany({
      where: { examScheduleId, status: { not: 'void' } },
    });
    const byStudent = new Map<string, any[]>();
    for (const a of allocations) {
      const list = byStudent.get(a.studentProfileId) ?? [];
      list.push(a);
      byStudent.set(a.studentProfileId, list);
    }
    const names = await this.ops.nameMap([...byStudent.keys()]);
    const tolerance = new D(paper.markToleranceMarks);

    const rows = [...byStudent.entries()].map(([studentProfileId, list]) => {
      const pick = (role: string) => list.find((a: any) => a.role === role);
      const first = pick('first');
      const second = pick('second');
      const recon = pick('reconciliation');
      const a = first?.score != null ? new D(first.score) : null;
      const b = second?.score != null ? new D(second.score) : null;
      const difference = a && b ? a.sub(b).abs() : null;
      const withinTolerance = difference ? difference.lte(tolerance) : null;
      const agreed = recon?.score != null ? new D(recon.score)
        : a && b && withinTolerance ? a.add(b).div(2)
        : a && !second ? a
        : null;
      return {
        studentProfileId,
        studentName: names.get(studentProfileId)?.name ?? null,
        anonymousCode: list[0]?.anonymousCode ?? null,
        first: first ? { id: first.id, score: first.score, markerId: first.markerId, status: first.status } : null,
        second: second ? { id: second.id, score: second.score, markerId: second.markerId, status: second.status } : null,
        reconciliation: recon ? { id: recon.id, score: recon.score, markerId: recon.markerId, status: recon.status } : null,
        difference: difference?.toString() ?? null,
        withinTolerance,
        agreedScore: agreed?.toString() ?? null,
        reconciled: list.some((x: any) => x.status === 'reconciled'),
        needsThirdRead: withinTolerance === false && !recon?.score,
      };
    }).sort((x, y) => (x.studentName ?? '').localeCompare(y.studentName ?? ''));

    return {
      paper: {
        id: paper.id, examId: paper.examId, examName: paper.exam.name,
        subjectName: paper.subject?.name ?? null, className: paper.schoolClass?.name ?? null,
        maxMarks: paper.maxMarks, markingMode: paper.markingMode,
        markToleranceMarks: paper.markToleranceMarks, marksLockedAt: paper.marksLockedAt,
        lifecycleState: paper.exam.lifecycleState,
      },
      summary: {
        scripts: rows.length,
        reconciled: rows.filter((r) => r.reconciled).length,
        needsThirdRead: rows.filter((r) => r.needsThirdRead).length,
        awaitingMarks: rows.filter((r) => !r.reconciled && !r.agreedScore && !r.needsThirdRead).length,
      },
      rows,
    };
  }

  /**
   * Agree the mark for a paper's scripts and post it to the canonical ledger.
   *
   * Single marking posts the one read. Double marking posts both reads and the
   * agreed mark: within tolerance the mean is agreed automatically, outside it
   * a third read is required and no mark is posted until one exists.
   */
  async reconcile(examScheduleId: string, dto: ReconcileScriptDto) {
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.examSchedule.findFirst({ where: { id: examScheduleId }, include: { exam: true } });
      if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);
      if (paper.marksLockedAt) throw new BadRequestException('This paper is locked');

      const assessment = await this.markableAssessment(tx, examScheduleId);

      const targets: string[] = dto.studentProfileIds?.length
        ? dto.studentProfileIds
        : (await tx.scriptAllocation.findMany({
            where: { examScheduleId, status: 'submitted' },
            select: { studentProfileId: true },
            distinct: ['studentProfileId'],
          })).map((r: any) => r.studentProfileId);
      if (!targets.length) throw new BadRequestException('No submitted scripts to agree');

      const tolerance = new D(paper.markToleranceMarks);
      const posted: Array<{ studentProfileId: string; agreedScore: string }> = [];
      const blocked: Array<{ studentProfileId: string; code: string; detail: string }> = [];

      for (const studentProfileId of [...targets].sort()) {
        const list = await tx.scriptAllocation.findMany({
          where: { examScheduleId, studentProfileId, status: { not: 'void' } },
        });
        if (!list.length) { blocked.push({ studentProfileId, code: 'NO_SCRIPT', detail: 'no script is allocated' }); continue; }
        const pick = (role: string) => list.find((a: any) => a.role === role);
        const first = pick('first');
        const second = pick('second');
        const recon = pick('reconciliation');

        if (!first || first.score == null) {
          blocked.push({ studentProfileId, code: 'FIRST_MARK_MISSING', detail: 'the first marker has not submitted' });
          continue;
        }
        const a = new D(first.score);
        let agreed: Prisma.Decimal;
        if (second) {
          if (second.score == null) {
            blocked.push({ studentProfileId, code: 'SECOND_MARK_MISSING', detail: 'the second marker has not submitted' });
            continue;
          }
          const b = new D(second.score);
          const diff = a.sub(b).abs();
          if (diff.gt(tolerance)) {
            if (recon?.score == null) {
              blocked.push({
                studentProfileId, code: 'OUT_OF_TOLERANCE',
                detail: `the two marks differ by ${diff.toString()}, above the ${tolerance.toString()} tolerance; a third read is required`,
              });
              continue;
            }
            agreed = new D(recon.score);
          } else {
            agreed = recon?.score != null ? new D(recon.score) : a.add(b).div(2);
          }
        } else {
          agreed = recon?.score != null ? new D(recon.score) : a;
        }

        // Post every marker round, then the agreed mark. `reconcileOriginal`
        // picks the reconciliation round, so the canonical score is the agreed
        // one and the two independent reads remain on the record.
        for (const alloc of list) {
          if (alloc.score == null) continue;
          const round = ROUND_FOR_ROLE[alloc.role];
          if (!round || round === 'reconciliation') continue;
          await this.marking.postMark(tx, {
            assessmentId: assessment.id,
            studentProfileId,
            score: alloc.score,
            round,
            source: 'exam',
            markerId: alloc.markerId,
            comment: alloc.comment ?? null,
            snapshot: { classId: paper.classId, termId: paper.exam.termId },
          });
        }
        await this.marking.postMark(tx, {
          assessmentId: assessment.id,
          studentProfileId,
          score: agreed,
          round: 'reconciliation',
          source: 'exam',
          markerId: this.tenant.userId ?? null,
          comment: dto.note ?? null,
          snapshot: { classId: paper.classId, termId: paper.exam.termId },
        });

        await tx.scriptAllocation.updateMany({
          where: { examScheduleId, studentProfileId, status: { not: 'void' } },
          data: { status: 'reconciled', version: { increment: 1 } },
        });
        posted.push({ studentProfileId, agreedScore: agreed.toString() });
      }

      await this.audit.recordInTx(tx, {
        entity: 'ScriptAllocation', entityId: examScheduleId, action: 'post',
        newValues: { examScheduleId, assessmentId: assessment.id, agreed: posted.length, blocked: blocked.length, note: dto.note ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolScriptReconciled, {
        organizationId: this.org, examId: paper.examId, examScheduleId, agreed: posted.length, blocked: blocked.length,
      });
      return { examScheduleId, agreed: posted.length, posted, blocked };
    });
  }

  // ── moderation ─────────────────────────────────────────────────────────────

  /**
   * Draw a moderation sample. The draw is reproducible: the same seed over the
   * same script list picks the same scripts, so "why these?" has an answer other
   * than "the computer chose".
   */
  async drawSample(examScheduleId: string, dto: DrawModerationSampleDto) {
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.examSchedule.findFirst({ where: { id: examScheduleId }, include: { exam: true } });
      if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);

      const reconciled = await tx.scriptAllocation.findMany({
        where: { examScheduleId, status: 'reconciled', role: 'first' },
        orderBy: { studentProfileId: 'asc' },
      });
      if (!reconciled.length) throw new BadRequestException('Agree the marks for this paper before drawing a moderation sample');

      const assessment = await tx.assessment.findFirst({
        where: { sourceType: 'exam_session', sourceRef: examScheduleId, deletedAt: null },
      });
      const canonical = assessment
        ? await tx.studentAssessment.findMany({
            where: { assessmentId: assessment.id, studentProfileId: { in: reconciled.map((r: any) => r.studentProfileId) } },
          })
        : [];
      const scoreOf = new Map<string, any>((canonical as any[]).map((r: any) => [r.studentProfileId, r.effectiveScore]));

      const seed = dto.seed ?? `${examScheduleId}:${Date.now()}`;
      const size = Math.max(1, Math.min(dto.sampleSize ?? Math.ceil(reconciled.length * 0.1), reconciled.length));
      const method = dto.method ?? 'stratified';
      const picked = this.pick(reconciled, size, method, seed, scoreOf, new D(paper.maxMarks));

      const sample = await tx.moderationSample.create({
        data: {
          organizationId: this.org,
          examScheduleId,
          method,
          seed,
          sampleSize: picked.length,
          toleranceMarks: dto.toleranceMarks ?? paper.markToleranceMarks,
          drawnById: this.tenant.userId ?? null,
          moderatorId: dto.moderatorId ?? null,
        },
      });
      await tx.moderationSampleItem.createMany({
        data: picked.map((p: any) => ({
          organizationId: this.org,
          sampleId: sample.id,
          studentProfileId: p.studentProfileId,
          anonymousCode: p.anonymousCode,
          originalScore: scoreOf.get(p.studentProfileId) ?? p.score,
        })),
      });

      await this.audit.recordInTx(tx, {
        entity: 'ModerationSample', entityId: sample.id, action: 'create',
        newValues: { examScheduleId, method, seed, sampleSize: picked.length },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolModerationSampleDrawn, {
        organizationId: this.org, examId: paper.examId, examScheduleId, sampleId: sample.id, sampleSize: picked.length,
      });
      return this.sample(sample.id, tx);
    });
  }

  async sample(sampleId: string, tx?: any) {
    const db = tx ?? this.db;
    const sample = await db.moderationSample.findFirst({
      where: { id: sampleId },
      include: { items: true, examSchedule: { include: { subject: { select: { name: true } }, schoolClass: { select: { name: true } } } } },
    });
    if (!sample) throw new NotFoundException(`Moderation sample ${sampleId} not found`);
    const names = await this.ops.nameMap(sample.items.map((i: any) => i.studentProfileId));
    return {
      ...sample,
      subjectName: sample.examSchedule?.subject?.name ?? null,
      className: sample.examSchedule?.schoolClass?.name ?? null,
      items: sample.items.map((i: any) => ({ ...i, studentName: names.get(i.studentProfileId)?.name ?? null })),
    };
  }

  async samples(examScheduleId: string) {
    return this.db.moderationSample.findMany({
      where: { examScheduleId },
      orderBy: { drawnAt: 'desc' },
      include: { items: true },
    });
  }

  /**
   * Record the moderator's re-marks and settle the sample.
   *
   * Where a re-mark falls outside tolerance the difference is applied to the
   * canonical mark as a `moderation` adjustment on the immutable ledger — never
   * by overwriting the marker's score.
   */
  async recordModeration(sampleId: string, dto: RecordModerationDto) {
    const outcome = await this.db.$transaction(async (tx: any) => {
      const sample = await tx.moderationSample.findFirst({ where: { id: sampleId }, include: { items: true } });
      if (!sample) throw new NotFoundException(`Moderation sample ${sampleId} not found`);
      if (['agreed', 'adjusted'].includes(sample.status)) throw new BadRequestException('This sample is already settled');
      const paper = await tx.examSchedule.findFirst({ where: { id: sample.examScheduleId }, include: { exam: true } });
      if (paper?.marksLockedAt) throw new BadRequestException('This paper is locked');

      const tolerance = new D(sample.toleranceMarks);
      const byStudent = new Map<string, any>((sample.items as any[]).map((i: any) => [i.studentProfileId, i]));
      let outside = 0;
      for (const row of dto.items) {
        const item: any = byStudent.get(row.studentProfileId);
        if (!item) throw new BadRequestException('That learner is not in this moderation sample');
        const original = item.originalScore != null ? new D(item.originalScore) : null;
        const moderated = new D(row.moderatedScore);
        if (moderated.lt(0) || moderated.gt(new D(paper!.maxMarks))) {
          throw new BadRequestException(`A moderated mark must be between 0 and ${String(paper!.maxMarks)}`);
        }
        const delta = original ? moderated.sub(original) : null;
        const within = delta ? delta.abs().lte(tolerance) : null;
        if (within === false) outside += 1;
        await tx.moderationSampleItem.updateMany({
          where: { id: item.id },
          data: { moderatedScore: moderated, delta, withinTolerance: within, comment: row.comment ?? null },
        });
      }

      const settled = outside > 0 ? 'adjusted' : 'agreed';
      await tx.moderationSample.updateMany({
        where: { id: sampleId },
        data: {
          status: settled,
          moderatorId: sample.moderatorId ?? this.tenant.userId ?? null,
          reviewedAt: new Date(),
          note: dto.note ?? null,
          outcome: { reviewed: dto.items.length, outsideTolerance: outside, tolerance: tolerance.toString() } as any,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ModerationSample', entityId: sampleId, action: 'adjust',
        newValues: { reviewed: dto.items.length, outsideTolerance: outside, status: settled },
      });
      return { sample, paper, settled, outside };
    });

    // Adjustments run through MarkingService's own transaction so the immutable
    // ledger, the recompute and the moderation event stay in one place.
    let adjusted = 0;
    if (dto.applyAdjustments !== false && outcome.settled === 'adjusted') {
      const assessment = await this.db.assessment.findFirst({
        where: { sourceType: 'exam_session', sourceRef: outcome.sample.examScheduleId, deletedAt: null },
      });
      if (assessment) {
        const items = await this.db.moderationSampleItem.findMany({
          where: { sampleId, withinTolerance: false },
        });
        for (const i of items) {
          const sa = await this.db.studentAssessment.findFirst({
            where: { assessmentId: assessment.id, studentProfileId: i.studentProfileId },
          });
          if (!sa) continue;
          await this.marking.appendAdjustment({
            studentAssessmentId: sa.id,
            kind: 'moderation',
            replacementScore: Number(i.moderatedScore),
            reason: `moderation sample ${sampleId}${i.comment ? `: ${i.comment}` : ''}`,
          });
          adjusted += 1;
        }
      }
    }

    this.events.publish(EVENTS.SchoolModerationCompleted, {
      organizationId: this.org,
      examScheduleId: outcome.sample.examScheduleId,
      sampleId,
      status: outcome.settled,
      outsideTolerance: outcome.outside,
      adjusted,
    });
    return { ...(await this.sample(sampleId)), adjusted };
  }

  // ── sampling ───────────────────────────────────────────────────────────────

  /** Deterministic 32-bit PRNG seeded from a string — same seed, same draw. */
  private rng(seed: string): () => number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return () => {
      h ^= h << 13; h >>>= 0;
      h ^= h >> 17;
      h ^= h << 5; h >>>= 0;
      return h / 4294967296;
    };
  }

  private pick(
    scripts: any[],
    size: number,
    method: string,
    seed: string,
    scoreOf: Map<string, any>,
    maxMarks: Prisma.Decimal,
  ): any[] {
    const scored = scripts.map((s) => ({
      ...s,
      value: scoreOf.get(s.studentProfileId) != null ? Number(scoreOf.get(s.studentProfileId)) : Number(s.score ?? 0),
    }));

    if (method === 'manual') return scored.slice(0, size);

    if (method === 'boundary') {
      // Scripts nearest a grade boundary are where a marking difference changes
      // the grade, so they are the ones worth a second opinion.
      const bounds = [40, 50, 60, 70, 80].map((p) => (Number(maxMarks) * p) / 100);
      return [...scored]
        .sort((a, b) => distanceTo(bounds, a.value) - distanceTo(bounds, b.value))
        .slice(0, size);
    }

    const random = this.rng(seed);
    if (method === 'random') {
      return [...scored].sort(() => random() - 0.5).slice(0, size);
    }

    // Stratified: spread the sample across low, middle and high marks.
    const sorted = [...scored].sort((a, b) => a.value - b.value);
    const strata = 3;
    const out: any[] = [];
    const per = Math.max(1, Math.floor(size / strata));
    for (let i = 0; i < strata; i += 1) {
      const from = Math.floor((sorted.length * i) / strata);
      const to = Math.floor((sorted.length * (i + 1)) / strata);
      const band = sorted.slice(from, to);
      if (!band.length) continue;
      const shuffled = [...band].sort(() => random() - 0.5);
      out.push(...shuffled.slice(0, per));
    }
    for (const s of sorted) {
      if (out.length >= size) break;
      if (!out.some((x) => x.id === s.id)) out.push(s);
    }
    return out.slice(0, size);
  }
}

function distanceTo(bounds: number[], value: number): number {
  return Math.min(...bounds.map((b) => Math.abs(b - value)));
}
