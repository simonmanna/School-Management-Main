import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EVENTS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { RecordCustodyDto } from './exam-operations.dto';

/**
 * Where the question papers have been, and who had them.
 *
 * The log is append-only and hash-chained: each event's `chainHash` covers the
 * previous event's hash and this event's own facts, so a removed or reordered
 * event breaks the chain and `verify` says exactly where. A correction is a new
 * event, never an edit — the database trigger enforces that too.
 */
const ORDER: Record<string, number> = {
  authored: 0, moderated: 1, approved: 2, printed: 3, sealed: 4, stored: 5,
  dispatched: 6, received: 7, opened: 8, distributed: 9, collected: 10,
  returned: 11, archived: 12, destroyed: 13, incident: 99,
};

/** Actions that must not happen before the papers have been sealed. */
const REQUIRES_SEAL = new Set(['dispatched', 'received', 'opened']);

@Injectable()
export class QuestionPaperCustodyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  private get db(): any { return this.prisma.client; }
  private get org(): string { return this.tenant.organizationId; }

  private hash(previousHash: string, e: Record<string, unknown>): string {
    return createHash('sha256')
      .update(`${previousHash}|${e.action}|${e.occurredAt}|${e.custodianId ?? ''}|${e.custodianName ?? ''}|${e.sealNumber ?? ''}|${e.copies ?? ''}|${e.location ?? ''}`)
      .digest('hex');
  }

  async record(questionPaperId: string, dto: RecordCustodyDto) {
    return this.db.$transaction(async (tx: any) => {
      const paper = await tx.questionPaper.findFirst({
        where: { id: questionPaperId },
        include: { examSchedule: { include: { exam: true } } },
      });
      if (!paper) throw new NotFoundException(`Question paper ${questionPaperId} not found`);

      const last = await tx.questionPaperCustodyEvent.findFirst({
        where: { questionPaperId },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      });

      // Order matters for real accountability: papers cannot be received before
      // they are dispatched, nor opened before they were sealed.
      if (last && dto.action !== 'incident' && (ORDER[dto.action] ?? 0) < (ORDER[last.action] ?? 0)) {
        throw new BadRequestException(
          `The papers were last recorded as '${last.action}'; '${dto.action}' cannot come after that. Record an incident instead.`,
        );
      }
      if (REQUIRES_SEAL.has(dto.action)) {
        const sealed = await tx.questionPaperCustodyEvent.count({ where: { questionPaperId, action: 'sealed' } });
        if (!sealed) throw new BadRequestException('Record the sealing of these papers before they move');
      }
      if (dto.action === 'sealed' && !dto.sealNumber?.trim()) {
        throw new BadRequestException('Sealing needs the seal number');
      }
      if (['dispatched', 'received', 'distributed', 'collected'].includes(dto.action) && !dto.custodianName?.trim() && !dto.custodianId) {
        throw new BadRequestException('Record who holds the papers after this movement');
      }

      const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
      if (last && occurredAt < last.occurredAt) {
        throw new BadRequestException('A custody event cannot be dated before the previous one');
      }

      const base = {
        action: dto.action,
        occurredAt: occurredAt.toISOString(),
        custodianId: dto.custodianId ?? null,
        custodianName: dto.custodianName ?? null,
        sealNumber: dto.sealNumber ?? null,
        copies: dto.copies ?? null,
        location: dto.location ?? null,
      };
      const event = await tx.questionPaperCustodyEvent.create({
        data: {
          organizationId: this.org,
          questionPaperId,
          examScheduleId: paper.examScheduleId,
          action: dto.action,
          occurredAt,
          actorId: this.tenant.userId ?? null,
          actorName: dto.actorName ?? null,
          custodianId: dto.custodianId ?? null,
          custodianName: dto.custodianName ?? null,
          sealNumber: dto.sealNumber ?? null,
          copies: dto.copies ?? null,
          location: dto.location ?? null,
          note: dto.note ?? null,
          previousEventId: last?.id ?? null,
          chainHash: this.hash(last?.chainHash ?? '', base),
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'QuestionPaperCustodyEvent', entityId: event.id, action: 'create',
        newValues: { questionPaperId, action: dto.action, custodianName: dto.custodianName ?? null, sealNumber: dto.sealNumber ?? null },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolQuestionPaperCustodyRecorded, {
        organizationId: this.org,
        examId: paper.examSchedule?.examId ?? null,
        questionPaperId,
        action: dto.action,
      });
      return event;
    });
  }

  /** The chain for one paper, plus whether it still verifies. */
  async chain(questionPaperId: string) {
    const paper = await this.db.questionPaper.findFirst({
      where: { id: questionPaperId },
      include: { examSchedule: { include: { subject: { select: { name: true } }, exam: { select: { id: true, name: true } } } } },
    });
    if (!paper) throw new NotFoundException(`Question paper ${questionPaperId} not found`);
    const events = await this.db.questionPaperCustodyEvent.findMany({
      where: { questionPaperId },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    let previousHash = '';
    let brokenAt: string | null = null;
    const verified = events.map((e: any) => {
      const expected = this.hash(previousHash, {
        action: e.action,
        occurredAt: e.occurredAt.toISOString(),
        custodianId: e.custodianId,
        custodianName: e.custodianName,
        sealNumber: e.sealNumber,
        copies: e.copies,
        location: e.location,
      });
      const ok = expected === e.chainHash;
      if (!ok && !brokenAt) brokenAt = e.id;
      previousHash = e.chainHash;
      return { ...e, chainVerified: ok };
    });

    const holder = [...events].reverse().find((e: any) => e.custodianName || e.custodianId);
    return {
      questionPaper: {
        id: paper.id,
        title: paper.title,
        paperKind: paper.paperKind,
        paperNumber: paper.paperNumber,
        totalMarks: paper.totalMarks,
        examScheduleId: paper.examScheduleId,
        examId: paper.examSchedule?.exam?.id ?? null,
        examName: paper.examSchedule?.exam?.name ?? null,
        subjectName: paper.examSchedule?.subject?.name ?? null,
      },
      chainIntact: !brokenAt,
      brokenAt,
      currentCustodian: holder ? { id: holder.custodianId, name: holder.custodianName } : null,
      lastAction: events.length ? events[events.length - 1].action : null,
      events: verified,
    };
  }

  /** Every paper in an exam with its custody position — the exam-office board. */
  async byExam(examId: string) {
    const schedules = await this.db.examSchedule.findMany({
      where: { examId },
      include: {
        subject: { select: { name: true } },
        schoolClass: { select: { name: true } },
        questionPapers: { orderBy: { paperNumber: 'asc' } },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
    const paperIds = schedules.flatMap((s: any) => s.questionPapers.map((p: any) => p.id));
    const events = paperIds.length
      ? await this.db.questionPaperCustodyEvent.findMany({
          where: { questionPaperId: { in: paperIds } },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    const byPaper = new Map<string, any[]>();
    for (const e of events) {
      const list = byPaper.get(e.questionPaperId) ?? [];
      list.push(e);
      byPaper.set(e.questionPaperId, list);
    }
    return schedules.flatMap((s: any) =>
      s.questionPapers.map((p: any) => {
        const list = byPaper.get(p.id) ?? [];
        const holder = [...list].reverse().find((e: any) => e.custodianName || e.custodianId);
        return {
          questionPaperId: p.id,
          title: p.title,
          paperKind: p.paperKind,
          paperNumber: p.paperNumber,
          examScheduleId: s.id,
          subjectName: s.subject?.name ?? null,
          className: s.schoolClass?.name ?? null,
          date: s.date,
          startTime: s.startTime,
          events: list.length,
          lastAction: list.length ? list[list.length - 1].action : null,
          lastAt: list.length ? list[list.length - 1].occurredAt : null,
          currentCustodian: holder?.custodianName ?? null,
          sealed: list.some((e: any) => e.action === 'sealed'),
          returned: list.some((e: any) => e.action === 'returned'),
        };
      }),
    );
  }
}
