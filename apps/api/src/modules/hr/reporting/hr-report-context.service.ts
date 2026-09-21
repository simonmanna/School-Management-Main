import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type {
  ReportContext,
  ReportContextBuilder,
  ReportDefinition,
} from '../../core/reporting/report.types';

/**
 * The HR namespace's ReportContextBuilder.
 *
 * School's builder resolves campuses to class ids and picks a class basis;
 * none of that means anything to a workforce report, which partitions by
 * department and pay period instead. That is exactly why the registry holds a
 * builder PER namespace rather than one global provider — forcing HR through
 * the school resolver would make every payroll report carry a class basis it
 * does not have.
 *
 * What this builder does own is the date window, because "1 Sep to 30 Sep" has
 * to mean the whole of the 30th in an HR report just as much as in a fee one.
 */
@Injectable()
export class HrReportContextService implements ReportContextBuilder {
  private readonly logger = new Logger('HrReportContext');

  constructor(
    private readonly tenant: TenantContextService,
    private readonly scope: DataScopeService,
  ) {}

  async build(
    def: ReportDefinition<any>,
    filters: Record<string, unknown>,
  ): Promise<ReportContext> {
    const f = filters as { dateFrom?: string; dateTo?: string; asOf?: string };

    let window: { from: Date; to: Date } | undefined;
    if (f.dateFrom || f.dateTo) {
      const from = f.dateFrom ? new Date(f.dateFrom) : new Date('1970-01-01');
      const to = f.dateTo ? new Date(f.dateTo) : new Date();
      if (from > to) throw new BadRequestException('dateFrom must not be after dateTo');
      // Inclusive of the whole closing day, matching the payroll engine's own
      // period arithmetic. Stopping at midnight would drop the last day's leave.
      to.setHours(23, 59, 59, 999);
      window = { from, to };
    }

    // HR reports have no historical reconstruction: headcount, balances and
    // registers are all read from current rows. Anything claiming `as-of` would
    // be pretending, so `asOf` is always now.
    const asOf = new Date();

    return {
      organizationId: this.tenant.organizationId,
      userId: this.tenant.userId,
      // Row scope for HR is carried by the `hr:*` permissions and the tenancy
      // extension, not by a class list — an HR officer either sees the
      // establishment or does not hold the report grant at all.
      scope: { effective: await this.scope.effective(), classIds: 'all' },
      resolved: { classBasis: 'current', window, asOf },
      logger: { warn: (m: string) => this.logger.warn(`[${def.key}] ${m}`) },
    };
  }
}
