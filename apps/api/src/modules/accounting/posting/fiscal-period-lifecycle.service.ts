import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from './posting.service';
import { periodBounds } from './fiscal-period.service';
import { safeTimeZone } from '../../../kernel/common/school-time';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CreatePeriodInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface UpdatePeriodInput {
  name?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Fiscal-period metadata and the reopen/unlock half of the lifecycle
 * (close/lock live in PeriodCloseService). Wave 18 rules:
 *
 * - A period is always created `open`, with no overlap and end-of-day bounds
 *   in the organization's time zone.
 * - Only an `open` period's name or dates can change, and a period that has
 *   been closed at least once can never be deleted.
 * - Reopen (`closed → open`, fiscal_period:reopen) and unlock (`locked → open`,
 *   fiscal_period:unlock) need a reason, refuse while any LATER period is
 *   closed or locked, reverse the closing entry dated as it was, and are
 *   audited with the prior close metadata.
 */
@Injectable()
export class FiscalPeriodLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
  ) {}

  async list(page = 1, pageSize = 50) {
    const where = { deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.fiscalPeriod.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.fiscalPeriod.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async findOne(id: string) {
    const item = await this.prisma.client.fiscalPeriod.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Fiscal period not found');
    return item;
  }

  async create(dto: CreatePeriodInput) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('A period name is required');
    return this.prisma.client.$transaction(async (tx: any) => {
      const { startDate, endDate } = periodBounds(dto.startDate, dto.endDate, await this.timeZone(tx));
      await this.assertNoOverlap(tx, startDate, endDate);
      const period = await tx.fiscalPeriod.create({
        data: { organizationId: this.tenant.organizationId, name, startDate, endDate, status: 'open' },
      });
      await this.audit.recordInTx(tx, {
        entity: 'FiscalPeriod',
        entityId: period.id,
        action: 'create',
        newValues: { name, startDate, endDate, status: 'open' },
      });
      return period;
    }).catch((e: any) => this.translateOverlap(e));
  }

  async update(id: string, dto: UpdatePeriodInput) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const period = await this.lockPeriod(tx, id);
      if (period.status !== 'open') {
        throw new ConflictException(`Fiscal period '${period.name}' is ${period.status}; only open periods can be edited`);
      }
      const data: any = {};
      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('A period name is required');
        data.name = name;
      }
      if (dto.startDate !== undefined || dto.endDate !== undefined) {
        const tz = await this.timeZone(tx);
        const startDay = dto.startDate ?? this.localDay(period.startDate, tz);
        const endDay = dto.endDate ?? this.localDay(period.endDate, tz);
        const { startDate, endDate } = periodBounds(startDay, endDay, tz);
        await this.assertNoOverlap(tx, startDate, endDate, id);
        data.startDate = startDate;
        data.endDate = endDate;
      }
      await tx.fiscalPeriod.updateMany({ where: { id, status: 'open' }, data });
      await this.audit.recordInTx(tx, {
        entity: 'FiscalPeriod',
        entityId: id,
        action: 'update',
        oldValues: { name: period.name, startDate: period.startDate, endDate: period.endDate },
        newValues: data,
      });
      return tx.fiscalPeriod.findFirst({ where: { id } });
    }).catch((e: any) => this.translateOverlap(e));
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const period = await this.lockPeriod(tx, id);
      if (period.status !== 'open') {
        throw new ConflictException(`Fiscal period '${period.name}' is ${period.status}; it cannot be deleted`);
      }
      const everClosed = await tx.journalEntry.count({ where: { sourceType: 'period_close', sourceId: id } });
      if (everClosed > 0) {
        throw new ConflictException(`Fiscal period '${period.name}' has been closed before; it cannot be deleted`);
      }
      await tx.fiscalPeriod.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'FiscalPeriod', entityId: id, action: 'delete' });
    });
  }

  /**
   * closed → open (mode 'reopen') or locked → open (mode 'unlock'). Returns the
   * reversed closing entry id, if there was one.
   */
  async reopen(id: string, reason: string, mode: 'reopen' | 'unlock') {
    const why = (reason ?? '').trim();
    if (why.length < 5) throw new BadRequestException('Give a reason (at least 5 characters) for reopening the period');
    const organizationId = this.tenant.organizationId;

    return this.prisma.client.$transaction(async (tx: any) => {
      const period = await this.lockPeriod(tx, id);
      if (period.status === 'open') throw new ConflictException(`Fiscal period '${period.name}' is already open`);
      if (mode === 'reopen' && period.status === 'locked') {
        throw new ForbiddenException(
          `Fiscal period '${period.name}' is locked; unlocking needs the fiscal_period:unlock permission`,
        );
      }
      if (mode === 'unlock' && period.status !== 'locked') {
        throw new ConflictException(`Fiscal period '${period.name}' is not locked; reopen it instead`);
      }

      const later = await tx.fiscalPeriod.findFirst({
        where: { deletedAt: null, id: { not: id }, startDate: { gt: period.endDate }, status: { in: ['closed', 'locked'] } },
        orderBy: { startDate: 'desc' },
      });
      if (later) {
        throw new ConflictException(
          `Reopen '${later.name}' first: a later period is ${later.status}, and reopening an earlier one would change its opening balances`,
        );
      }

      const flipped = await tx.fiscalPeriod.updateMany({
        where: { id, status: period.status },
        data: { status: 'open', closedAt: null, closedBy: null, lockedAt: null },
      });
      if (flipped.count === 0) throw new ConflictException('Fiscal period changed concurrently; retry');

      // Unwind the closing entry on its own date (inside the now-open period),
      // so a later re-close starts from the real revenue/expense balances.
      const closing = await tx.journalEntry.findFirst({
        where: { organizationId, sourceType: 'period_close', sourceId: id, status: 'posted' },
        orderBy: { postedAt: 'desc' },
      });
      let reversedClosingEntryId: string | null = null;
      if (closing) {
        await this.posting.reverse(
          closing.id,
          { date: closing.postingDate, description: `Reopen ${period.name}: ${why}`, allowPeriodClose: true },
          tx,
        );
        reversedClosingEntryId = closing.id;
      }

      await this.audit.recordInTx(tx, {
        entity: 'FiscalPeriod',
        entityId: id,
        action: 'update',
        oldValues: {
          status: period.status,
          closedAt: period.closedAt,
          closedBy: period.closedBy,
          lockedAt: period.lockedAt,
        },
        newValues: { status: 'open', op: mode, reason: why, reversedClosingEntryId },
      });

      this.events.publish('fiscal_period.reopened', {
        organizationId,
        periodId: id,
        periodName: period.name,
        fromStatus: period.status,
        reason: why,
        reversedClosingEntryId,
      });
      return { reopened: true, status: 'open', fromStatus: period.status, reversedClosingEntryId };
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async lockPeriod(tx: any, id: string) {
    await tx.$queryRawUnsafe(
      `SELECT id FROM "FiscalPeriod" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
      id,
      this.tenant.organizationId,
    );
    const period = await tx.fiscalPeriod.findFirst({ where: { id, deletedAt: null } });
    if (!period) throw new NotFoundException('Fiscal period not found');
    return period;
  }

  private async assertNoOverlap(tx: any, startDate: Date, endDate: Date, exceptId?: string) {
    const clash = await tx.fiscalPeriod.findFirst({
      where: {
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (clash) throw new ConflictException(`Dates overlap fiscal period '${clash.name}'`);
  }

  /** The database exclusion constraint is the backstop for concurrent creates. */
  private translateOverlap(e: any): never {
    const msg = String(e?.message ?? '');
    if (msg.includes('FiscalPeriod_no_overlap') || e?.meta?.code === '23P01' || msg.includes('23P01')) {
      throw new ConflictException('Dates overlap another fiscal period');
    }
    throw e;
  }

  private async timeZone(tx: any): Promise<string> {
    const org = await tx.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: { timezone: true },
    });
    return safeTimeZone(org?.timezone ?? 'UTC');
  }

  private localDay(at: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  }
}
