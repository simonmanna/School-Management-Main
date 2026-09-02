import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { MarkingService } from '../assessment/marking.service';
import { ExamOperationsService } from './exam-operations.service';
import type {
  DecideConsiderationDto,
  RecordAttendanceDto,
  RaiseIncidentDto,
  RequestConsiderationDto,
  ResolveIncidentDto,
} from './exam-operations.dto';

/** Attendance states that mean the candidate produced a script. */
const SAT = ['present', 'late'];

/**
 * What happened in the hall: who sat which paper, what went wrong, and which
 * access arrangements were granted.
 *
 * Attendance is not a mark. An absence recorded here sets the learner's
 * canonical participation so the result engine excludes them explicitly —
 * blank is not zero, and absent is only zero when the published policy says so.
 */
@Injectable()
export class ExamSessionService {
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

  // ── attendance ─────────────────────────────────────────────────────────────

  /** The register for one paper: every candidate, with whatever is recorded. */
  async register(examScheduleId: string) {
    const paper = await this.db.examSchedule.findFirst({
      where: { id: examScheduleId },
      include: {
        exam: true,
        subject: { select: { id: true, name: true } },
        schoolClass: { select: { id: true, name: true } },
        venue: { select: { id: true, name: true, capacity: true } },
      },
    });
    if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);

    const candidateIds = await this.ops.candidateIds(this.db, paper.exam);
    // The register covers the candidates for THIS paper's class. A whole-exam
    // snapshot spans several classes; showing all of them on one paper's
    // register is how a class ends up marked absent from a paper it never sat.
    const entries = paper.exam.activeSnapshotId
      ? await this.db.examCandidateEntry.findMany({ where: { snapshotId: paper.exam.activeSnapshotId } })
      : [];
    const scoped: string[] = entries.length
      ? entries.filter((e: any) => !e.classId || e.classId === paper.classId).map((e: any) => e.studentProfileId as string)
      : candidateIds;

    const [attendance, considerations, names] = await Promise.all([
      this.db.examAttendance.findMany({ where: { examScheduleId } }),
      this.db.specialConsideration.findMany({
        where: { examId: paper.examId, status: 'approved', OR: [{ examScheduleId: null }, { examScheduleId }] },
      }),
      this.ops.nameMap(scoped),
    ]);
    const byStudent = new Map<string, any>((attendance as any[]).map((a: any) => [a.studentProfileId, a]));
    const entryByStudent = new Map<string, any>((entries as any[]).map((e: any) => [e.studentProfileId, e]));
    const considerationsByStudent = new Map<string, any[]>();
    for (const c of considerations) {
      const list = considerationsByStudent.get(c.studentProfileId) ?? [];
      list.push(c);
      considerationsByStudent.set(c.studentProfileId, list);
    }

    return {
      paper: {
        id: paper.id,
        examId: paper.examId,
        examName: paper.exam.name,
        lifecycleState: paper.exam.lifecycleState,
        subjectId: paper.subjectId,
        subjectName: paper.subject?.name ?? null,
        classId: paper.classId,
        className: paper.schoolClass?.name ?? null,
        date: paper.date,
        startTime: paper.startTime,
        durationMinutes: paper.durationMinutes,
        maxMarks: paper.maxMarks,
        venueId: paper.venueId,
        venueName: paper.venue?.name ?? null,
        markingMode: paper.markingMode,
        marksLockedAt: paper.marksLockedAt,
      },
      rows: scoped.map((studentProfileId) => {
        const a: any = byStudent.get(studentProfileId);
        const e: any = entryByStudent.get(studentProfileId);
        return {
          studentProfileId,
          studentName: names.get(studentProfileId)?.name ?? null,
          admissionNo: names.get(studentProfileId)?.admissionNo ?? null,
          candidateNumber: e?.candidateNumber ?? null,
          seatNumber: a?.seatNumber ?? e?.seatNumber ?? null,
          venueId: a?.venueId ?? e?.venueId ?? paper.venueId ?? null,
          status: a?.status ?? null,
          arrivedAt: a?.arrivedAt ?? null,
          scriptNumber: a?.scriptNumber ?? null,
          note: a?.note ?? null,
          recorded: !!a,
          considerations: (considerationsByStudent.get(studentProfileId) ?? []).map((c: any) => ({
            id: c.id, type: c.type, extraTimeMinutes: c.extraTimeMinutes, exemptsFromResult: c.exemptsFromResult,
          })),
        };
      }),
      summary: {
        expected: scoped.length,
        recorded: attendance.filter((a: any) => scoped.includes(a.studentProfileId)).length,
        present: attendance.filter((a: any) => SAT.includes(a.status)).length,
        absent: attendance.filter((a: any) => a.status === 'absent').length,
      },
    };
  }

  /**
   * Record the register for a paper, in one transaction.
   *
   * An absence also lands on the canonical `StudentAssessment.participation`, so
   * the result engine sees "absent", not a missing row it could mistake for
   * an unmarked script.
   */
  async recordAttendance(examScheduleId: string, dto: RecordAttendanceDto) {
    if (!dto.rows.length) throw new BadRequestException('Nothing to record');
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.examSchedule.findFirst({ where: { id: examScheduleId }, include: { exam: true } });
      if (!paper) throw new NotFoundException(`Exam paper ${examScheduleId} not found`);
      if (paper.marksLockedAt) throw new BadRequestException('This paper is locked; attendance can no longer be changed');
      if (['closed', 'archived'].includes(paper.exam.lifecycleState)) {
        throw new BadRequestException('This examination is closed');
      }

      const candidateIds = new Set(await this.ops.candidateIds(tx, paper.exam));
      const unknown = dto.rows.filter((r) => !candidateIds.has(r.studentProfileId));
      if (unknown.length) {
        throw new BadRequestException(
          `${unknown.length} learner(s) are not candidates for this examination. Register and re-freeze the candidate list first.`,
        );
      }

      const assessment = await tx.assessment.findFirst({
        where: { sourceType: 'exam_session', sourceRef: examScheduleId, deletedAt: null },
      });

      const now = new Date();
      const saved: any[] = [];
      // Deterministic order keeps concurrent registers from deadlocking.
      for (const row of [...dto.rows].sort((a, b) => a.studentProfileId.localeCompare(b.studentProfileId))) {
        const existing = await tx.examAttendance.findFirst({
          where: { examScheduleId, studentProfileId: row.studentProfileId },
        });
        const data = {
          status: row.status,
          arrivedAt: row.arrivedAt ? new Date(row.arrivedAt) : (SAT.includes(row.status) ? (existing?.arrivedAt ?? now) : null),
          leftAt: row.leftAt ? new Date(row.leftAt) : existing?.leftAt ?? null,
          venueId: row.venueId ?? existing?.venueId ?? paper.venueId ?? null,
          seatNumber: row.seatNumber ?? existing?.seatNumber ?? null,
          scriptNumber: row.scriptNumber ?? existing?.scriptNumber ?? null,
          note: row.note ?? existing?.note ?? null,
          recordedById: this.tenant.userId ?? null,
          recordedAt: now,
        };
        const out = existing
          ? await tx.examAttendance.update({ where: { id: existing.id }, data })
          : await tx.examAttendance.create({
              data: { organizationId: this.org, examScheduleId, studentProfileId: row.studentProfileId, ...data },
            });
        saved.push(out);

        // Project non-participation onto the canonical learner row.
        if (assessment && !SAT.includes(row.status)) {
          const participation = row.status === 'malpractice' ? 'malpractice'
            : row.status === 'excused' ? 'excused'
            : row.status === 'withdrawn' ? 'withdrawn'
            : 'absent';
          await this.marking.setParticipationInTx(tx, {
            assessmentId: assessment.id,
            studentProfileId: row.studentProfileId,
            participation: participation as any,
            classId: paper.classId,
            termId: paper.exam.termId,
            reason: `exam attendance: ${row.status}`,
          });
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'ExamAttendance',
        entityId: examScheduleId,
        action: 'create',
        newValues: { examScheduleId, rows: saved.length, statuses: countBy(dto.rows.map((r) => r.status)) },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolExamAttendanceRecorded, {
        organizationId: this.org, examId: paper.examId, examScheduleId, recorded: saved.length,
      });
      return { examScheduleId, recorded: saved.length, rows: saved };
    });
  }

  // ── incidents ──────────────────────────────────────────────────────────────

  async raiseIncident(dto: RaiseIncidentDto) {
    return this.db.$transaction(async (tx: any) => {
      const exam = await tx.exam.findFirst({ where: { id: dto.examId } });
      if (!exam) throw new NotFoundException(`Exam ${dto.examId} not found`);
      if (dto.examScheduleId) {
        const paper = await tx.examSchedule.findFirst({ where: { id: dto.examScheduleId, examId: dto.examId } });
        if (!paper) throw new BadRequestException('That paper does not belong to this examination');
      }
      const incident = await tx.examIncident.create({
        data: {
          organizationId: this.org,
          examId: dto.examId,
          examScheduleId: dto.examScheduleId ?? null,
          studentProfileId: dto.studentProfileId ?? null,
          type: dto.type,
          severity: dto.severity ?? 'medium',
          description: dto.description,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
          reportedById: this.tenant.userId ?? null,
          evidence: (dto.evidence as any) ?? [],
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ExamIncident', entityId: incident.id, action: 'create',
        newValues: { examId: dto.examId, type: dto.type, severity: incident.severity, studentProfileId: dto.studentProfileId ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolExamIncidentRaised, {
        organizationId: this.org, examId: dto.examId, incidentId: incident.id, type: dto.type, severity: incident.severity,
      });
      return incident;
    });
  }

  /**
   * Close an incident. A malpractice finding that is upheld sets the candidate's
   * participation to `malpractice` on that paper — the result engine then
   * excludes it rather than scoring it zero by accident.
   */
  async resolveIncident(id: string, dto: ResolveIncidentDto) {
    return this.db.$transaction(async (tx: any) => {
      const incident = await tx.examIncident.findFirst({ where: { id } });
      if (!incident) throw new NotFoundException(`Incident ${id} not found`);
      if (['resolved', 'dismissed'].includes(incident.status)) {
        throw new BadRequestException(`This incident is already ${incident.status}`);
      }
      if (!dto.resolution?.trim()) throw new BadRequestException('An incident is closed with a written outcome');

      await tx.examIncident.updateMany({
        where: { id },
        data: {
          status: dto.status,
          resolution: dto.resolution,
          reviewedById: this.tenant.userId ?? null,
          reviewedAt: new Date(),
        },
      });

      if (dto.status === 'resolved' && dto.upholdMalpractice && incident.studentProfileId && incident.examScheduleId) {
        const paper = await tx.examSchedule.findFirst({ where: { id: incident.examScheduleId }, include: { exam: true } });
        const assessment = paper && await tx.assessment.findFirst({
          where: { sourceType: 'exam_session', sourceRef: paper.id, deletedAt: null },
        });
        if (assessment) {
          await this.marking.setParticipationInTx(tx, {
            assessmentId: assessment.id,
            studentProfileId: incident.studentProfileId,
            participation: 'malpractice' as any,
            classId: paper.classId,
            termId: paper.exam.termId,
            reason: `incident ${id} upheld`,
          });
        }
        await tx.examAttendance.updateMany({
          where: { examScheduleId: incident.examScheduleId, studentProfileId: incident.studentProfileId },
          data: { status: 'malpractice' },
        });
      }

      await this.audit.recordInTx(tx, {
        entity: 'ExamIncident', entityId: id, action: dto.status === 'dismissed' ? 'reject' : 'approve',
        oldValues: { status: incident.status },
        newValues: { status: dto.status, resolution: dto.resolution, upholdMalpractice: !!dto.upholdMalpractice },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolExamIncidentResolved, {
        organizationId: this.org, examId: incident.examId, incidentId: id, status: dto.status,
      });
      return tx.examIncident.findFirst({ where: { id } });
    });
  }

  // ── special consideration ──────────────────────────────────────────────────

  async requestConsideration(dto: RequestConsiderationDto) {
    return this.db.$transaction(async (tx: any) => {
      const exam = await tx.exam.findFirst({ where: { id: dto.examId } });
      if (!exam) throw new NotFoundException(`Exam ${dto.examId} not found`);
      if (['closed', 'archived'].includes(exam.lifecycleState)) {
        throw new BadRequestException('This examination is closed');
      }
      if (dto.type === 'extra_time' && !dto.extraTimeMinutes) {
        throw new BadRequestException('Extra time needs a number of minutes');
      }
      const row = await tx.specialConsideration.create({
        data: {
          organizationId: this.org,
          examId: dto.examId,
          studentProfileId: dto.studentProfileId,
          examScheduleId: dto.examScheduleId ?? null,
          type: dto.type,
          extraTimeMinutes: dto.extraTimeMinutes ?? null,
          reason: dto.reason,
          evidence: (dto.evidence as any) ?? [],
          exemptsFromResult: dto.exemptsFromResult ?? false,
          requestedById: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'SpecialConsideration', entityId: row.id, action: 'create',
        newValues: { examId: dto.examId, studentProfileId: dto.studentProfileId, type: dto.type },
      });
      return row;
    });
  }

  /**
   * Approve or refuse an access arrangement. Approval is a separate act from the
   * request — the requester cannot decide their own — and an approved exemption
   * writes `exempt` onto the learner's assessment so aggregation drops it
   * rather than treating a missing script as a zero.
   */
  async decideConsideration(id: string, dto: DecideConsiderationDto) {
    return this.db.$transaction(async (tx: any) => {
      const row = await tx.specialConsideration.findFirst({ where: { id } });
      if (!row) throw new NotFoundException(`Special consideration ${id} not found`);
      if (row.status !== 'requested') throw new BadRequestException(`This request is already '${row.status}'`);
      const userId = this.tenant.userId ?? null;
      if (row.requestedById && userId && row.requestedById === userId) {
        throw new BadRequestException('An access arrangement is decided by someone other than whoever requested it');
      }
      if (dto.status === 'rejected' && !dto.decisionNote?.trim()) {
        throw new BadRequestException('A refusal needs a reason');
      }

      await tx.specialConsideration.updateMany({
        where: { id },
        data: { status: dto.status, decidedById: userId, decidedAt: new Date(), decisionNote: dto.decisionNote ?? null },
      });

      let exempted = 0;
      if (dto.status === 'approved' && row.exemptsFromResult) {
        const papers = await tx.examSchedule.findMany({
          where: { examId: row.examId, ...(row.examScheduleId ? { id: row.examScheduleId } : {}) },
          include: { exam: true },
        });
        for (const paper of papers) {
          const assessment = await tx.assessment.findFirst({
            where: { sourceType: 'exam_session', sourceRef: paper.id, deletedAt: null },
          });
          if (!assessment) continue;
          await this.marking.setParticipationInTx(tx, {
            assessmentId: assessment.id,
            studentProfileId: row.studentProfileId,
            participation: 'exempt' as any,
            classId: paper.classId,
            termId: paper.exam.termId,
            reason: `special consideration ${id}`,
          });
          exempted += 1;
        }
      }

      await this.audit.recordInTx(tx, {
        entity: 'SpecialConsideration', entityId: id, action: dto.status === 'approved' ? 'approve' : 'reject',
        oldValues: { status: row.status },
        newValues: { status: dto.status, decisionNote: dto.decisionNote ?? null, papersExempted: exempted },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolSpecialConsiderationDecided, {
        organizationId: this.org, examId: row.examId, considerationId: id, status: dto.status,
        studentProfileId: row.studentProfileId, papersExempted: exempted,
      });
      return { ...(await tx.specialConsideration.findFirst({ where: { id } })), papersExempted: exempted };
    });
  }

  async incidents(examId: string) {
    const rows = await this.db.examIncident.findMany({ where: { examId }, orderBy: { occurredAt: 'desc' } });
    const names = await this.ops.nameMap(rows.map((r: any) => r.studentProfileId).filter(Boolean));
    return rows.map((r: any) => ({ ...r, studentName: r.studentProfileId ? names.get(r.studentProfileId)?.name ?? null : null }));
  }

  async considerations(examId: string) {
    const rows = await this.db.specialConsideration.findMany({ where: { examId }, orderBy: { createdAt: 'desc' } });
    const names = await this.ops.nameMap(rows.map((r: any) => r.studentProfileId));
    return rows.map((r: any) => ({ ...r, studentName: names.get(r.studentProfileId)?.name ?? null }));
  }
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
}
