import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Period control (ADR-009 + audit fix #6). A posting date is rejected when:
 *   1. it is on/before the org's `booksLockDate` (hard close), OR
 *   2. it falls inside a `closed` / `locked` fiscal period, OR
 *   3. `requireFiscalPeriod` is on and no period covers the date.
 *
 * Otherwise posting is allowed (orgs that don't manage periods are unaffected).
 */
@Injectable()
export class FiscalPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async assertOpen(date: Date, client: any = this.prisma.client): Promise<void> {
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

    const period = await client.fiscalPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: date } },
    });

    // 3) No period covers the date and the org requires one.
    if (!period) {
      if (org?.requireFiscalPeriod) {
        throw new BadRequestException(
          `No fiscal period is defined for ${date.toISOString().slice(0, 10)}; posting requires an open period`,
        );
      }
      return;
    }

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
