import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { ExamLifecycleActionDto, FreezeCandidatesDto } from './exam-operations.dto';

/** A blocked transition, named so the exam office can act on it. */
export interface ExamGateConflict {
  code: string;
  detail: string;
  examScheduleId?: string;
  studentProfileId?: string;
}

export type ExamLifecycleState =
  | 'draft' | 'setup' | 'scheduled' | 'candidates_locked' | 'in_progress'
  | 'marking' | 'moderation' | 'results_ready' | 'closed' | 'archived';

/**
 * The exam-office state machine.
 *
 * Every edge is a deliberate act with its own precondition; nothing advances
 * because a date passed. `Exam.status` stays as the coarse legacy flag the older
 * screens read, and is kept consistent here rather than being a second truth.
 */
const TRANSITIONS: Record<ExamLifecycleState, ExamLifecycleState[]> = {
  draft: ['setup', 'archived'],
  setup: ['scheduled', 'draft', 'archived'],
  scheduled: ['candidates_locked', 'setup', 'archived'],
  candidates_locked: ['in_progress', 'scheduled', 'archived'],
  in_progress: ['marking', 'archived'],
  marking: ['moderation', 'results_ready', 'archived'],
  moderation: ['results_ready', 'marking', 'archived'],
  results_ready: ['closed', 'marking', 'archived'],
  closed: ['archived', 'results_ready'],
  archived: [],
};

/** Legacy `Exam.status` projection, so the old screens never disagree with this. */
const LEGACY_STATUS: Record<ExamLifecycleState, 'draft' | 'scheduled' | 'published' | 'closed'> = {
  draft: 'draft',
  setup: 'draft',
  scheduled: 'scheduled',
  candidates_locked: 'published',
  in_progress: 'published',
  marking: 'published',
  moderation: 'published',
  results_ready: 'published',
  closed: 'closed',
  archived: 'closed',
};

const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const STATE_ORDER: ExamLifecycleState[] = [
  'draft', 'setup', 'scheduled', 'candidates_locked', 'in_progress',
  'marking', 'moderation', 'results_ready', 'closed', 'archived',
];

@Injectable()
export class ExamOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org(): string { return this.tenant.organizationId; }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Everything the operations console needs for one exam, in one request. */
  async overview(examId: string) {
    const exam = await this.db.exam.findFirst({
      where: { id: examId },
      include: { examType: true, term: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);

    const [schedules, registrations, snapshots, incidents, considerations] = await Promise.all([
      this.db.examSchedule.findMany({
        where: { examId },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        include: {
          subject: { select: { id: true, name: true, code: true } },
          schoolClass: { select: { id: true, name: true } },
          venue: { select: { id: true, name: true, capacity: true } },
          invigilatorAssignments: { include: { invigilator: { select: { id: true, name: true } } } },
          questionPapers: { select: { id: true, title: true, paperKind: true, totalMarks: true } },
          _count: { select: { attendance: true, scriptAllocations: true, moderationSamples: true } },
        },
      }),
      this.db.examRegistration.findMany({ where: { examId } }),
      this.db.examCandidateSnapshot.findMany({ where: { examId }, orderBy: { revision: 'desc' } }),
      this.db.examIncident.findMany({ where: { examId }, orderBy: { occurredAt: 'desc' }, take: 100 }),
      this.db.specialConsideration.findMany({ where: { examId }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);

    const studentIds = [...new Set<string>([
      ...registrations.map((r: any) => r.studentProfileId),
      ...incidents.map((i: any) => i.studentProfileId).filter(Boolean),
      ...considerations.map((c: any) => c.studentProfileId),
    ])];
    const names = await this.nameMap(studentIds);

    const steps = await this.steps(exam, schedules, registrations, snapshots);

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeId: exam.examTypeId,
        examTypeName: exam.examType?.name ?? null,
        startDate: exam.startDate,
        endDate: exam.endDate,
        status: exam.status,
        lifecycleState: exam.lifecycleState as ExamLifecycleState,
        markingMode: exam.markingMode,
        activeSnapshotId: exam.activeSnapshotId,
        candidatesLockedAt: exam.candidatesLockedAt,
        resultsReadyAt: exam.resultsReadyAt,
        closedAt: exam.closedAt,
        version: exam.version,
        allowedTransitions: TRANSITIONS[exam.lifecycleState as ExamLifecycleState] ?? [],
      },
      steps,
      papers: schedules.map((s: any) => ({
        id: s.id,
        subjectId: s.subjectId,
        subjectName: s.subject?.name ?? null,
        classId: s.classId,
        className: s.schoolClass?.name ?? null,
        date: s.date,
        startTime: s.startTime,
        durationMinutes: s.durationMinutes,
        paperNumber: s.paperNumber,
        sitting: s.sitting,
        isResit: s.isResit,
        maxMarks: s.maxMarks,
        venueId: s.venueId,
        venueName: s.venue?.name ?? null,
        venueCapacity: s.venue?.capacity ?? null,
        markingMode: s.markingMode,
        markToleranceMarks: s.markToleranceMarks,
        moderationRequired: s.moderationRequired,
        marksLockedAt: s.marksLockedAt,
        invigilators: s.invigilatorAssignments.map((a: any) => ({ id: a.invigilatorId, name: a.invigilator?.name ?? null })),
        questionPapers: s.questionPapers,
        attendanceRecorded: s._count.attendance,
        scriptsAllocated: s._count.scriptAllocations,
        moderationSamples: s._count.moderationSamples,
      })),
      candidates: registrations.map((r: any) => ({
        id: r.id,
        studentProfileId: r.studentProfileId,
        studentName: names.get(r.studentProfileId)?.name ?? null,
        admissionNo: names.get(r.studentProfileId)?.admissionNo ?? null,
        classId: r.classId,
        venueId: r.venueId,
        seatNumber: r.seatNumber,
        status: r.status,
      })),
      snapshots: snapshots.map((s: any) => ({
        id: s.id, revision: s.revision, checksum: s.checksum, candidateCount: s.candidateCount,
        frozenAt: s.frozenAt, reason: s.reason, isActive: s.id === exam.activeSnapshotId,
      })),
      incidents: incidents.map((i: any) => ({
        ...i, studentName: i.studentProfileId ? names.get(i.studentProfileId)?.name ?? null : null,
      })),
      considerations: considerations.map((c: any) => ({
        ...c, studentName: names.get(c.studentProfileId)?.name ?? null,
      })),
    };
  }

  /** The candidate list a snapshot froze, with names for display. */
  async snapshot(snapshotId: string) {
    const snap = await this.db.examCandidateSnapshot.findFirst({
      where: { id: snapshotId },
      include: { entries: { orderBy: [{ classId: 'asc' }, { candidateNumber: 'asc' }] } },
    });
    if (!snap) throw new NotFoundException(`Candidate snapshot ${snapshotId} not found`);
    const names = await this.nameMap(snap.entries.map((e: any) => e.studentProfileId));
    return {
      ...snap,
      /** Recomputed from the stored rows — a mismatch means the list was tampered with. */
      checksumVerified: snap.checksum === this.checksumOf(snap.entries),
      entries: snap.entries.map((e: any) => ({
        ...e,
        studentName: names.get(e.studentProfileId)?.name ?? null,
        admissionNo: names.get(e.studentProfileId)?.admissionNo ?? null,
      })),
    };
  }

  // ── candidate snapshot ─────────────────────────────────────────────────────

  /**
   * Freeze the current registration list. The snapshot — not `ExamRegistration`
   * — is what the exam was sat under, so a candidate added afterwards does not
   * silently join a sitting that has already happened. Re-freezing supersedes.
   */
  async freezeCandidates(examId: string, dto: FreezeCandidatesDto) {
    return this.db.$transaction(async (tx: any) => {
      const exam = await tx.exam.findFirst({ where: { id: examId } });
      if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
      if (['closed', 'archived'].includes(exam.lifecycleState)) {
        throw new BadRequestException('This examination is closed; candidates can no longer be frozen');
      }
      if (exam.lifecycleState !== 'scheduled' && exam.activeSnapshotId && !dto.reason) {
        throw new BadRequestException('Re-freezing an in-flight examination needs a reason');
      }

      const registrations = await tx.examRegistration.findMany({
        where: { examId, status: { not: 'withheld' } },
        orderBy: [{ classId: 'asc' }, { createdAt: 'asc' }],
      });
      if (!registrations.length) {
        throw new BadRequestException('Register candidates before freezing the list');
      }

      const students = await tx.studentProfile.findMany({
        where: { id: { in: registrations.map((r: any) => r.studentProfileId) } },
        select: { id: true, admissionNo: true, currentSectionId: true, currentStreamId: true },
      });
      const byId = new Map<string, any>((students as any[]).map((s: any) => [s.id, s]));

      const prior = exam.activeSnapshotId
        ? await tx.examCandidateSnapshot.findFirst({ where: { id: exam.activeSnapshotId } })
        : await tx.examCandidateSnapshot.findFirst({ where: { examId }, orderBy: { revision: 'desc' } });
      const revision = (prior?.revision ?? 0) + 1;

      const rows = registrations.map((r: any, i: number) => {
        const p: any = byId.get(r.studentProfileId);
        return {
          organizationId: this.org,
          studentProfileId: r.studentProfileId,
          examRegistrationId: r.id,
          classId: r.classId ?? null,
          sectionId: p?.currentSectionId ?? null,
          streamId: p?.currentStreamId ?? null,
          candidateNumber: p?.admissionNo ?? String(i + 1).padStart(4, '0'),
          indexNumber: null as string | null,
          venueId: r.venueId ?? null,
          seatNumber: r.seatNumber ?? null,
        };
      });

      const snapshot = await tx.examCandidateSnapshot.create({
        data: {
          organizationId: this.org,
          examId,
          revision,
          checksum: this.checksumOf(rows),
          candidateCount: rows.length,
          reason: dto.reason ?? null,
          frozenById: this.tenant.userId ?? null,
          supersedesId: prior?.id ?? null,
        },
      });
      await tx.examCandidateEntry.createMany({
        data: rows.map((r: any) => ({ ...r, snapshotId: snapshot.id })),
      });
      await tx.exam.updateMany({
        where: { id: examId },
        data: {
          activeSnapshotId: snapshot.id,
          candidatesLockedAt: new Date(),
          candidatesLockedById: this.tenant.userId ?? null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'ExamCandidateSnapshot',
        entityId: snapshot.id,
        action: 'create',
        newValues: { examId, revision, candidateCount: rows.length, checksum: snapshot.checksum, reason: dto.reason ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolExamCandidatesFrozen, {
        organizationId: this.org, examId, snapshotId: snapshot.id, revision, candidateCount: rows.length,
      });
      return { ...snapshot, supersededRevision: prior?.revision ?? null };
    });
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Report the gate for every step without moving anything. The console renders
   * this so the office reads "3 papers have no invigilator", not "failed".
   */
  async gate(examId: string, target: ExamLifecycleState): Promise<{ ready: boolean; conflicts: ExamGateConflict[] }> {
    const exam = await this.db.exam.findFirst({ where: { id: examId } });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
    const conflicts = await this.checkGate(this.db, exam, target);
    return { ready: conflicts.length === 0, conflicts };
  }

  async transition(examId: string, dto: ExamLifecycleActionDto) {
    const target = dto.target as ExamLifecycleState;
    return this.db.$transaction(async (tx: any) => {
      const exam = await tx.exam.findFirst({ where: { id: examId } });
      if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
      const from = exam.lifecycleState as ExamLifecycleState;

      if (dto.expectedVersion !== undefined && dto.expectedVersion !== exam.version) {
        throw new ConflictException({
          code: 'EXAM_VERSION_CONFLICT',
          message: 'Someone else changed this examination while you were working',
          currentVersion: exam.version,
          currentState: from,
        });
      }
      if (!(TRANSITIONS[from] ?? []).includes(target)) {
        throw new BadRequestException(`An examination cannot move from '${from}' to '${target}'`);
      }
      // Going backwards is a correction and needs a reason on the record.
      const backwards = !this.isForward(from, target);
      if (backwards && target !== 'archived' && !dto.reason) {
        throw new BadRequestException('Moving an examination back a step needs a reason');
      }

      const conflicts = backwards ? [] : await this.checkGate(tx, exam, target);
      if (conflicts.length) {
        throw new BadRequestException({ message: 'This step is not ready yet', code: 'EXAM_GATE_BLOCKED', conflicts });
      }

      const now = new Date();
      await tx.exam.updateMany({
        where: { id: examId, version: exam.version },
        data: {
          lifecycleState: target,
          status: LEGACY_STATUS[target],
          version: { increment: 1 },
          ...(target === 'results_ready' ? { resultsReadyAt: now } : {}),
          ...(target === 'closed' ? { closedAt: now } : {}),
        },
      });

      // Closing an exam locks every paper's marks. An unlocked paper inside a
      // closed exam is exactly the gap someone edits a mark through.
      if (target === 'closed') {
        await tx.examSchedule.updateMany({
          where: { examId, marksLockedAt: null },
          data: { marksLockedAt: now, marksLockedById: this.tenant.userId ?? null },
        });
      }

      await this.audit.recordInTx(tx, {
        entity: 'Exam',
        entityId: examId,
        action: 'post',
        oldValues: { lifecycleState: from, status: exam.status },
        newValues: { lifecycleState: target, status: LEGACY_STATUS[target], reason: dto.reason ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolExamLifecycleChanged, {
        organizationId: this.org, examId, from, to: target, reason: dto.reason ?? null,
      });
      return tx.exam.findFirst({ where: { id: examId } });
    });
  }

  /** Set the marking mode for one paper. Blocked once scripts are out. */
  async configurePaper(examScheduleId: string, dto: { markingMode?: string; markToleranceMarks?: number; moderationRequired?: boolean }) {
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.examSchedule.findFirst({ where: { id: examScheduleId } });
      if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);
      if (paper.marksLockedAt) throw new BadRequestException('This paper is locked; unlock it before changing how it is marked');
      if (dto.markingMode && dto.markingMode !== paper.markingMode) {
        const allocated = await tx.scriptAllocation.count({ where: { examScheduleId, status: { not: 'void' } } });
        if (allocated > 0) {
          throw new BadRequestException('Scripts are already allocated for this paper. Void the allocation before changing the marking mode.');
        }
      }
      await tx.examSchedule.updateMany({
        where: { id: examScheduleId },
        data: {
          ...(dto.markingMode ? { markingMode: dto.markingMode } : {}),
          ...(dto.markToleranceMarks !== undefined ? { markToleranceMarks: dto.markToleranceMarks } : {}),
          ...(dto.moderationRequired !== undefined ? { moderationRequired: dto.moderationRequired } : {}),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ExamSchedule', entityId: examScheduleId, action: 'update',
        oldValues: { markingMode: paper.markingMode, markToleranceMarks: paper.markToleranceMarks, moderationRequired: paper.moderationRequired },
        newValues: dto as any,
      });
      return tx.examSchedule.findFirst({ where: { id: examScheduleId } });
    });
  }

  // ── gate rules ─────────────────────────────────────────────────────────────

  private async checkGate(db: any, exam: any, target: ExamLifecycleState): Promise<ExamGateConflict[]> {
    const c: ExamGateConflict[] = [];
    const examId = exam.id;

    if (target === 'setup') {
      if (!exam.termId) c.push({ code: 'NO_TERM', detail: 'the examination has no term' });
      if (exam.endDate < exam.startDate) c.push({ code: 'BAD_DATES', detail: 'the end date is before the start date' });
      return c;
    }

    const papers = await db.examSchedule.findMany({ where: { examId }, include: { venue: true } });

    if (target === 'scheduled') {
      if (!papers.length) c.push({ code: 'NO_PAPERS', detail: 'no papers have been configured' });
      for (const p of papers) {
        if (!p.date || !p.startTime) c.push({ code: 'PAPER_NOT_TIMETABLED', examScheduleId: p.id, detail: 'this paper has no date or start time' });
        if (Number(p.maxMarks) <= 0) c.push({ code: 'PAPER_NO_MARKS', examScheduleId: p.id, detail: 'this paper has no maximum mark' });
      }
      c.push(...await this.timetableConflicts(db, examId));
      return c;
    }

    if (target === 'candidates_locked') {
      const snapshot = exam.activeSnapshotId
        ? await db.examCandidateSnapshot.findFirst({ where: { id: exam.activeSnapshotId } })
        : null;
      if (!snapshot) {
        c.push({ code: 'NO_CANDIDATE_SNAPSHOT', detail: 'the candidate list has not been frozen' });
        return c;
      }
      const registered = await db.examRegistration.count({ where: { examId, status: { not: 'withheld' } } });
      if (registered !== snapshot.candidateCount) {
        c.push({
          code: 'SNAPSHOT_STALE',
          detail: `${registered} candidates are registered but the frozen list holds ${snapshot.candidateCount}. Freeze it again.`,
        });
      }
      c.push(...await this.venueCapacityConflicts(db, examId, papers));
      return c;
    }

    if (target === 'in_progress') {
      for (const p of papers) {
        const invigilators = await db.invigilatorAssignment.count({ where: { examScheduleId: p.id } });
        if (invigilators === 0 && !p.invigilatorId) {
          c.push({ code: 'NO_INVIGILATOR', examScheduleId: p.id, detail: 'this paper has no invigilator' });
        }
      }
      const pendingConsiderations = await db.specialConsideration.count({ where: { examId, status: 'requested' } });
      if (pendingConsiderations > 0) {
        c.push({ code: 'CONSIDERATIONS_UNDECIDED', detail: `${pendingConsiderations} access arrangement request(s) have not been decided` });
      }
      return c;
    }

    const candidateIds = await this.candidateIds(db, exam);

    if (target === 'marking') {
      for (const p of papers) {
        const recorded = await db.examAttendance.count({ where: { examScheduleId: p.id } });
        if (recorded < candidateIds.length) {
          c.push({
            code: 'ATTENDANCE_INCOMPLETE',
            examScheduleId: p.id,
            detail: `${candidateIds.length - recorded} candidate(s) have no attendance record for this paper`,
          });
        }
        // Marks reach the results through the canonical assessment, and a draft
        // assessment cannot receive one. Catching that here — rather than at the
        // moment a marker submits — is the difference between "publish this
        // paper's assessment" and a conflict deep in the mark writer.
        const assessment = await db.assessment.findFirst({
          where: { sourceType: 'exam_session', sourceRef: p.id, deletedAt: null },
          select: { id: true, status: true, rosterId: true },
        });
        if (!assessment) {
          c.push({ code: 'PAPER_NOT_PROJECTED', examScheduleId: p.id, detail: 'this paper has no canonical assessment' });
        } else if (!assessment.rosterId || ['draft', 'scheduled', 'archived'].includes(assessment.status)) {
          c.push({
            code: 'PAPER_ASSESSMENT_NOT_PUBLISHED',
            examScheduleId: p.id,
            detail: `this paper's assessment is '${assessment.status}'; publish it on the assessment board before marking`,
          });
        }
      }
      return c;
    }

    if (target === 'moderation' || target === 'results_ready') {
      for (const p of papers) {
        const sat = await db.examAttendance.findMany({
          where: { examScheduleId: p.id, status: { in: ['present', 'late'] } },
          select: { studentProfileId: true },
        });
        const satIds = sat.map((a: any) => a.studentProfileId);
        if (!satIds.length) continue;

        const allocations = await db.scriptAllocation.findMany({
          where: { examScheduleId: p.id, status: { not: 'void' } },
        });
        const outstanding = allocations.filter((a: any) => a.status === 'allocated' || a.status === 'in_progress');
        if (outstanding.length) {
          c.push({ code: 'SCRIPTS_UNMARKED', examScheduleId: p.id, detail: `${outstanding.length} script(s) are still with a marker` });
        }
        const reconciled = new Set(
          allocations.filter((a: any) => a.status === 'reconciled').map((a: any) => a.studentProfileId),
        );
        if (allocations.length) {
          for (const id of satIds) {
            if (!reconciled.has(id)) {
              c.push({ code: 'SCRIPT_NOT_RECONCILED', examScheduleId: p.id, studentProfileId: id, detail: 'this script has no agreed mark yet' });
            }
          }
        }
        if (target === 'results_ready' && p.moderationRequired) {
          const done = await db.moderationSample.count({
            where: { examScheduleId: p.id, status: { in: ['agreed', 'adjusted'] } },
          });
          if (done === 0) c.push({ code: 'MODERATION_OUTSTANDING', examScheduleId: p.id, detail: 'this paper requires moderation and none has been completed' });
        }
      }
      if (target === 'results_ready') {
        const open = await db.examIncident.count({ where: { examId, status: { in: ['open', 'under_review'] } } });
        if (open > 0) c.push({ code: 'INCIDENTS_OPEN', detail: `${open} incident(s) are still open` });
        c.push(...await this.unapprovedExamMarks(db, papers));
      }
      return c;
    }

    if (target === 'closed') {
      const open = await db.examIncident.count({ where: { examId, status: { in: ['open', 'under_review'] } } });
      if (open > 0) c.push({ code: 'INCIDENTS_OPEN', detail: `${open} incident(s) are still open` });
      c.push(...await this.unapprovedExamMarks(db, papers));
      return c;
    }

    return c;
  }

  /** Approved-mark check over the canonical assessment rows behind these papers. */
  private async unapprovedExamMarks(db: any, papers: any[]): Promise<ExamGateConflict[]> {
    const out: ExamGateConflict[] = [];
    for (const p of papers) {
      const assessment = await db.assessment.findFirst({
        where: { sourceType: 'exam_session', sourceRef: p.id, deletedAt: null },
        select: { id: true },
      });
      if (!assessment) {
        out.push({ code: 'PAPER_NOT_PROJECTED', examScheduleId: p.id, detail: 'this paper has no canonical assessment; its marks cannot reach the results' });
        continue;
      }
      const rows = await db.studentAssessment.findMany({
        where: { assessmentId: assessment.id },
        select: { studentProfileId: true, approvalStatus: true, participation: true },
      });
      const pending = rows.filter(
        (r: any) => r.approvalStatus !== 'approved' && !['exempt', 'excused', 'absent', 'malpractice'].includes(r.participation),
      );
      for (const r of pending.slice(0, 25)) {
        out.push({ code: 'EXAM_MARKS_NOT_APPROVED', examScheduleId: p.id, studentProfileId: r.studentProfileId, detail: `marks are '${r.approvalStatus}'` });
      }
    }
    return out;
  }

  /** Venue double-booking and over-capacity, at the paper level. */
  private async venueCapacityConflicts(db: any, examId: string, papers: any[]): Promise<ExamGateConflict[]> {
    const out: ExamGateConflict[] = [];
    const seatedByVenue: any[] = await db.examRegistration
      .groupBy({ by: ['venueId'], where: { examId, venueId: { not: null } }, _count: { _all: true } })
      .catch(() => [] as any[]);
    const seated = new Map<string, number>(
      seatedByVenue.map((r: any) => [r.venueId as string, Number(r._count._all)]),
    );
    const unseated = await db.examRegistration.count({ where: { examId, venueId: null, status: { not: 'withheld' } } });
    if (unseated > 0 && papers.some((p: any) => p.venueId)) {
      out.push({ code: 'CANDIDATES_UNSEATED', detail: `${unseated} candidate(s) have no seat` });
    }
    for (const [venueId, count] of seated) {
      const venue = await db.examVenue.findFirst({ where: { id: venueId } });
      if (venue && count > venue.capacity) {
        out.push({ code: 'VENUE_OVER_CAPACITY', detail: `${venue.name} seats ${venue.capacity} but ${count} candidates are allocated to it` });
      }
    }
    return out;
  }

  /**
   * Timetable clashes across the whole exam: a venue or invigilator booked twice
   * in one slot, and a candidate expected in two rooms at once.
   */
  async timetableConflicts(db: any, examId: string): Promise<ExamGateConflict[]> {
    const papers = await db.examSchedule.findMany({ where: { examId }, include: { venue: true } });
    const out: ExamGateConflict[] = [];
    const slot = (p: any) => `${new Date(p.date).toISOString().slice(0, 10)}T${p.startTime}`;

    const venueSlots = new Map<string, string>();
    for (const p of papers) {
      if (!p.venueId) continue;
      const key = `${p.venueId}|${slot(p)}`;
      const prior = venueSlots.get(key);
      if (prior) out.push({ code: 'VENUE_CLASH', examScheduleId: p.id, detail: `${p.venue?.name ?? 'this room'} is already booked at ${slot(p)}` });
      else venueSlots.set(key, p.id);
    }

    const assignments = await db.invigilatorAssignment.findMany({
      where: { examScheduleId: { in: papers.map((p: any) => p.id) } },
    });
    const byPaper = new Map<string, any>(papers.map((p: any) => [p.id, p]));
    const invigSlots = new Map<string, string>();
    for (const a of assignments) {
      const p = byPaper.get(a.examScheduleId);
      if (!p) continue;
      const key = `${a.invigilatorId}|${slot(p)}`;
      if (invigSlots.get(key)) out.push({ code: 'INVIGILATOR_CLASH', examScheduleId: p.id, detail: `this invigilator is already assigned at ${slot(p)}` });
      else invigSlots.set(key, p.id);
    }

    // Candidate clash: two papers for the same class in the same slot.
    const classSlots = new Map<string, string>();
    for (const p of papers) {
      const key = `${p.classId}|${slot(p)}`;
      if (classSlots.get(key)) out.push({ code: 'CANDIDATE_CLASH', examScheduleId: p.id, detail: `this class already sits another paper at ${slot(p)}` });
      else classSlots.set(key, p.id);
    }
    return out;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The frozen candidate list where one exists, otherwise the live registrations. */
  async candidateIds(db: any, exam: any): Promise<string[]> {
    if (exam.activeSnapshotId) {
      const entries = await db.examCandidateEntry.findMany({
        where: { snapshotId: exam.activeSnapshotId },
        select: { studentProfileId: true },
      });
      return entries.map((e: any) => e.studentProfileId);
    }
    const regs = await db.examRegistration.findMany({
      where: { examId: exam.id, status: { not: 'withheld' } },
      select: { studentProfileId: true },
    });
    return regs.map((r: any) => r.studentProfileId);
  }

  private checksumOf(rows: Array<{ studentProfileId: string; classId?: string | null; candidateNumber?: string | null; seatNumber?: string | null }>): string {
    const canonical = rows
      .map((r) => [r.studentProfileId, r.classId ?? '', r.candidateNumber ?? '', r.seatNumber ?? ''].join('|'))
      .sort();
    return sha(canonical);
  }

  private isForward(from: ExamLifecycleState, to: ExamLifecycleState): boolean {
    return STATE_ORDER.indexOf(to) > STATE_ORDER.indexOf(from);
  }

  async nameMap(ids: string[]): Promise<Map<string, { name: string; admissionNo: string | null }>> {
    const out = new Map<string, { name: string; admissionNo: string | null }>();
    if (!ids.length) return out;
    const rows = await this.db.studentProfile.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    for (const r of rows as any[]) {
      out.set(r.id, { name: r.partner?.name ?? r.admissionNo ?? '', admissionNo: r.admissionNo ?? null });
    }
    return out;
  }

  /**
   * The ten-step console: what each step needs, and whether it is done.
   *
   * The steps are a VIEW over the lifecycle and the underlying rows — never a
   * second state store. A step is complete because the thing it asks for exists,
   * not because someone ticked it.
   */
  private async steps(exam: any, papers: any[], registrations: any[], snapshots: any[]) {
    const state = exam.lifecycleState as ExamLifecycleState;
    const reached = (s: ExamLifecycleState) => STATE_ORDER.indexOf(state) >= STATE_ORDER.indexOf(s);
    const paperIds = papers.map((p: any) => p.id);
    const [attendance, allocations, reconciled, samples, incidentsOpen, considerationsPending, custody] = await Promise.all([
      paperIds.length ? this.db.examAttendance.count({ where: { examScheduleId: { in: paperIds } } }) : 0,
      paperIds.length ? this.db.scriptAllocation.count({ where: { examScheduleId: { in: paperIds }, status: { not: 'void' } } }) : 0,
      paperIds.length ? this.db.scriptAllocation.count({ where: { examScheduleId: { in: paperIds }, status: 'reconciled' } }) : 0,
      paperIds.length ? this.db.moderationSample.count({ where: { examScheduleId: { in: paperIds }, status: { in: ['agreed', 'adjusted'] } } }) : 0,
      this.db.examIncident.count({ where: { examId: exam.id, status: { in: ['open', 'under_review'] } } }),
      this.db.specialConsideration.count({ where: { examId: exam.id, status: 'requested' } }),
      paperIds.length ? this.db.questionPaperCustodyEvent.count({ where: { examScheduleId: { in: paperIds } } }) : 0,
    ]);
    const invigilated = paperIds.length
      ? await this.db.invigilatorAssignment.findMany({ where: { examScheduleId: { in: paperIds } }, select: { examScheduleId: true } })
      : [];
    const invigilatedPapers = new Set(invigilated.map((a: any) => a.examScheduleId)).size;
    const seated = registrations.filter((r: any) => r.venueId).length;
    const active = snapshots.find((s: any) => s.id === exam.activeSnapshotId) ?? null;

    return [
      { key: 'event', label: 'Create the examination', done: true, detail: exam.name },
      { key: 'papers', label: 'Configure papers', done: papers.length > 0, detail: `${papers.length} paper(s)` },
      { key: 'candidates', label: 'Register candidates', done: registrations.length > 0, detail: `${registrations.length} candidate(s)` },
      { key: 'snapshot', label: 'Freeze the candidate list', done: !!active, detail: active ? `revision ${active.revision}, ${active.candidateCount} candidates` : 'not frozen' },
      { key: 'timetable', label: 'Timetable the papers', done: papers.length > 0 && papers.every((p: any) => p.date && p.startTime), detail: `${papers.filter((p: any) => p.date && p.startTime).length}/${papers.length} timetabled` },
      { key: 'venues', label: 'Allocate rooms and seats', done: registrations.length > 0 && seated === registrations.length, detail: `${seated}/${registrations.length} seated` },
      { key: 'invigilators', label: 'Assign invigilators', done: papers.length > 0 && invigilatedPapers === papers.length, detail: `${invigilatedPapers}/${papers.length} paper(s) covered` },
      { key: 'custody', label: 'Log question-paper custody', done: custody > 0, detail: `${custody} custody event(s)` },
      { key: 'attendance', label: 'Record attendance and incidents', done: attendance > 0 && incidentsOpen === 0 && considerationsPending === 0, detail: `${attendance} register entr(ies), ${incidentsOpen} open incident(s), ${considerationsPending} undecided arrangement(s)` },
      { key: 'marking', label: 'Mark and moderate', done: allocations > 0 && reconciled > 0, detail: `${reconciled}/${allocations} script read(s) agreed, ${samples} moderation sample(s) settled` },
      { key: 'approve', label: 'Approve and lock', done: reached('results_ready'), detail: exam.closedAt ? 'closed' : exam.resultsReadyAt ? 'results ready' : 'outstanding' },
    ];
  }
}
