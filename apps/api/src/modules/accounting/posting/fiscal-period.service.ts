import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { safeTimeZone, zonedMidnight } from '../../../kernel/common/school-time';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The instants a fiscal period covers for calendar days `startDay`..`endDay`
 * (inclusive, `YYYY-MM-DD`) in `timeZone`: local midnight of the first day to
 * the last millisecond of the last day. Storing the end as end-of-day means an
 * inclusive `lte endDate` catches a posting made at 23:30 on the last day —
 * a midnight end silently dropped the whole last day (wave 18).
 */
export function periodBounds(startDay: string, endDay: string, timeZone: string): { startDate: Date; endDate: Date } {
  const s = DAY_RE.exec(startDay);
  const e = DAY_RE.exec(endDay);
  if (!s || !e) throw new BadRequestException('Period dates must be calendar days (YYYY-MM-DD)');
  const tz = safeTimeZone(timeZone);
  const startDate = zonedMidnight(Number(s[1]), Number(s[2]), Number(s[3]), tz);
  const next = new Date(Date.UTC(Number(e[1]), Number(e[2]) - 1, Number(e[3]) + 1));
  const endDate = new Date(
    zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz).getTime() - 1,
  );
  if (endDate.getTime() <= startDate.getTime()) {
    throw new BadRequestException('A fiscal period must end after it starts');
  }
  return { startDate, endDate };
}

/**
 * Period control (ADR-009 + audit fix #6). A posting date is rejected when:
 *   1. it is on/before the org's `booksLockDate` (hard close), OR
 *   2. it falls inside a `closed` / `locked` fiscal period, OR
 *   3. `requireFiscalPeriod` is on and no period covers the date.
 *
 * Otherwise posting is allowed (orgs that don't manage periods are unaffected).
 *
 * Wave 18: the covering period row is taken FOR SHARE, so a concurrent close
 * (FOR UPDATE) waits for in-flight postings and then counts them — or the
 * posting waits for the close and is refused. More than one covering period is
 * a data fault and refuses the posting rather than picking one at random.
 */
@Injectable()
export class FiscalPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async assertOpen(date: Date, client: any = this.prisma.client): Promise<void> {
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid posting date');
    const org = await client.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: { booksLockDate: true, requireFiscalPeriod: true },
    });

    // 1) Hard close — books locked through a date.
    if (org?.booksLockDate && date.getTime() <= new Date(org.booksLockDate).getTime()) {
      throw new BadRequestException(
        `Books are locked through ${new Date(org.booksLockDate).toISOString().slice(0, 10)}; cannot post on ${date.toISOString().slice(0, 10)}`,
      );
    }

    const covering = await client.fiscalPeriod.findMany({
      where: { deletedAt: null, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true },
      take: 2,
    });
    if (covering.length > 1) {
      throw new BadRequestException(
        `More than one fiscal period covers ${date.toISOString().slice(0, 10)}; fix the overlapping periods before posting`,
      );
    }

    // 3) No period covers the date and the org requires one.
    if (covering.length === 0) {
      if (org?.requireFiscalPeriod) {
        throw new BadRequestException(
          `No fiscal period is defined for ${date.toISOString().slice(0, 10)}; posting requires an open period`,
        );
      }
      return;
    }

    // Serialize against close/lock/reopen of this period.
    if (typeof client.$queryRawUnsafe === 'function') {
      await client.$queryRawUnsafe(`SELECT id FROM "FiscalPeriod" WHERE id = $1 FOR SHARE`, covering[0].id);
    }
    const period = await client.fiscalPeriod.findFirst({ where: { id: covering[0].id } });

    // 2) Period exists but is not open.
    if (period.status === 'locked') {
      throw new BadRequestException(
        `Fiscal period '${period.name}' is locked; cannot post on ${date.toISOString().slice(0, 10)}`,
      );
    }
    if (period.status === 'closed') {
      throw new BadRequestException(
        `Fiscal period '${period.name}' is closed; reopen or post to a different period`,
      );
    }
  }
}
