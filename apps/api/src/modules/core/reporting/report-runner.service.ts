import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { PaginatedResult } from '@erp/shared';
import { PermissionResolverService } from '../../../kernel/auth/permission-resolver.service';
import { computeTotals, sortRows } from './report-format.util';
import type { ReportFilterDto, RunReportDto } from './report-params.dto';
import { ReportRegistryService } from './report-registry.service';
import type {
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportResult,
  ReportRow,
  ReportRunOptions,
} from './report.types';

/** Hard ceiling for an on-screen run. Above this the runner refuses. */
export const MAX_REPORT_ROWS = 50_000;
/** Hard ceiling for an export. Above this the runner refuses. */
export const MAX_EXPORT_ROWS = 100_000;
/** pdfkit needs the whole row set to size columns; past this, CSV/XLSX only. */
export const MAX_PDF_ROWS = 5_000;

export interface RunnerOutput extends PaginatedResult<ReportRow> {
  key: string;
  title: string;
  columns: ReportColumn[];
  totals?: ReportRow;
  groups?: ReportResult['groups'];
  caption?: string;
  notes: string[];
}

/**
 * ReportRunnerService — permission, validation, dispatch, paging, totals.
 *
 * This is the only place the row caps live, and the only place a per-report
 * permission is checked. A generic controller can carry just one blanket route
 * grant, so if this check is skipped a fee report becomes readable by anyone who
 * can open the report centre.
 */
@Injectable()
export class ReportRunnerService {
  private readonly logger = new Logger('ReportRunner');

  constructor(
    private readonly registry: ReportRegistryService,
    private readonly permissions: PermissionResolverService,
  ) {}

  /** Throw unless the caller holds every grant this definition demands. */
  async assertMayRun(def: ReportDefinition<any>): Promise<void> {
    const required = this.registry.requiredPermissions(def);
    const granted = await this.permissions.grantedForCaller();
    if (granted.includes('*')) return;
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
    }
  }

  /**
   * Reject filters the definition does not declare, and demand the ones it
   * requires. Silently ignoring an unsupported filter is how a class-scoped
   * report becomes a school-wide one.
   */
  private validateFilters(def: ReportDefinition<any>, filters: ReportFilterDto): void {
    const declared = new Set<string>(def.filters);
    const supplied = Object.entries(filters ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k]) => k);

    const undeclared = supplied.filter((k) => !declared.has(k));
    if (undeclared.length > 0) {
      throw new BadRequestException(
        `Report "${def.key}" does not accept filter(s): ${undeclared.join(', ')}. ` +
          `Accepted: ${def.filters.join(', ')}`,
      );
    }

    const missing = (def.requiredFilters ?? []).filter(
      (k) => filters?.[k as keyof ReportFilterDto] === undefined
        || filters?.[k as keyof ReportFilterDto] === null
        || filters?.[k as keyof ReportFilterDto] === '',
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Report "${def.key}" requires filter(s): ${missing.join(', ')}`,
      );
    }
  }

  private async resolveColumns(
    def: ReportDefinition<any>,
    ctx: ReportContext,
    params: ReportFilterDto,
    result?: ReportResult,
  ): Promise<ReportColumn[]> {
    // A matrix report may declare its columns from the data it just fetched.
    if (result?.columns?.length) return result.columns;
    if (typeof def.columns === 'function') return def.columns(ctx, params);
    return def.columns;
  }

  /**
   * `sortBy` reaches Prisma `orderBy` in any `paging:'service'` definition, so
   * an unvalidated value is an injection vector. Only a declared column key passes.
   */
  private validateSort(def: ReportDefinition<any>, columns: ReportColumn[], sortBy?: string): void {
    if (!sortBy) return;
    if (!columns.some((c) => c.key === sortBy)) {
      throw new BadRequestException(
        `Report "${def.key}" cannot sort by "${sortBy}". Sortable: ${columns.map((c) => c.key).join(', ')}`,
      );
    }
  }

  private capFor(unpaged: boolean): number {
    return unpaged ? MAX_EXPORT_ROWS : MAX_REPORT_ROWS;
  }

  private assertWithinCap(def: ReportDefinition<any>, count: number, unpaged: boolean): void {
    const cap = this.capFor(unpaged);
    if (count <= cap) return;
    // Never truncate. A financial report that silently drops rows is worse than
    // one that refuses: the reader has no way to know the total is short.
    throw new PayloadTooLargeException(
      `Report "${def.key}" produced ${count.toLocaleString()} rows, over the ${cap.toLocaleString()} limit. ` +
        `Narrow it with: ${def.filters.join(', ')}.`,
    );
  }

  /**
   * Run a report to a paged result.
   *
   * `unpaged` is set by the export path — the whole set is materialised, sorted
   * and totalled, and paging is skipped.
   */
  async run(key: string, dto: RunReportDto, unpaged = false): Promise<RunnerOutput> {
    const def = this.registry.get(key);
    await this.assertMayRun(def);

    const filters = dto.filters ?? ({} as ReportFilterDto);
    this.validateFilters(def, filters);

    const ctx = await this.registry.builderFor(key).build(def, { ...filters });
    const notes: string[] = [];

    // An as-of that cannot be honoured is pinned and declared, never laundered.
    if (def.asOfMode === 'current-only' && filters.asOf) {
      notes.push(
        'This report cannot reconstruct history: the underlying figures are current balances. ' +
          'Showing current values as at today, not as at the requested date.',
      );
    }

    const opts: ReportRunOptions = {
      page: dto.page ?? 1,
      pageSize: dto.pageSize ?? 25,
      sortBy: dto.sortBy ?? def.defaultSort?.key,
      sortOrder: dto.sortOrder ?? def.defaultSort?.order ?? 'asc',
      unpaged,
    };

    const result = await def.run(ctx, filters as any, opts);
    // Pupil-level rows pass the caller's data scope here, whatever the
    // definition did (audit F02): a report must never show more than the
    // pupil screens do.
    if (ctx.scope.filterRows && result.rows?.length) {
      const before = result.rows.length;
      result.rows = await ctx.scope.filterRows(result.rows);
      if (def.paging === 'service' && result.total != null) result.total -= before - result.rows.length;
    }
    const columns = await this.resolveColumns(def, ctx, filters, result);
    this.validateSort(def, columns, dto.sortBy);

    let rows = result.rows ?? [];
    let total: number;
    let page = opts.page;
    let pageSize = opts.pageSize;

    if (def.paging === 'service') {
      // The definition already applied skip/take and knows the true total.
      total = result.total ?? rows.length;
      this.assertWithinCap(def, unpaged ? total : rows.length, unpaged);
    } else {
      this.assertWithinCap(def, rows.length, unpaged);
      if (def.rowCapHint && rows.length > def.rowCapHint) {
        this.logger.warn(
          `Report "${def.key}" returned ${rows.length} rows, past its hint of ${def.rowCapHint}`,
        );
      }
      if (opts.sortBy) rows = sortRows(rows, columns, opts.sortBy, opts.sortOrder ?? 'asc');
      total = rows.length;
      if (unpaged || def.paging === 'none') {
        page = 1;
        pageSize = total;
      } else {
        const start = (page - 1) * pageSize;
        rows = rows.slice(start, start + pageSize);
      }
    }

    // Totals span the WHOLE report, not the visible page — a page-local total on
    // a fee report is a number that means nothing and looks authoritative.
    const totals = result.totals
      ?? (def.paging === 'service' ? undefined : computeTotals(
        def.paging === 'none' || unpaged ? rows : (result.rows ?? []),
        columns,
      ));

    return {
      key: def.key,
      title: def.title,
      columns,
      data: rows,
      meta: {
        page,
        pageSize,
        total,
        totalPages: pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      },
      totals,
      groups: result.groups,
      caption: this.buildCaption(def, ctx, result),
      notes: [...notes, ...(result.notes ?? [])],
    };
  }

  /**
   * The line printed at the top of every export. It always names the resolved
   * class basis, because that is the single most likely reason two reports
   * disagree about how many pupils are in P5.
   */
  private buildCaption(
    def: ReportDefinition<any>,
    ctx: ReportContext,
    result: ReportResult,
  ): string {
    const parts: string[] = [];
    if (result.caption) parts.push(result.caption);
    if (def.asOfMode === 'as-of' || def.asOfMode === 'current-only') {
      parts.push(`As at ${ctx.resolved.asOf.toISOString().slice(0, 10)}`);
    }
    if (ctx.resolved.window) {
      parts.push(
        `${ctx.resolved.window.from.toISOString().slice(0, 10)} to ${ctx.resolved.window.to.toISOString().slice(0, 10)}`,
      );
    }
    if (def.classBasisDefault) parts.push(`Class basis: ${ctx.resolved.classBasis}`);
    parts.push(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
    return parts.join(' · ');
  }

  /** Filename stem for an export: `student-register-2026-08-31`. */
  filenameFor(key: string): string {
    return `${key.replace(/\./g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  }
}
