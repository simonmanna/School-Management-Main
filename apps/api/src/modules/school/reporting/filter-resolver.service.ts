import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import type {
  ClassBasis,
  ReportContext,
  ReportContextBuilder,
  ReportDefinition,
} from '../../core/reporting/report.types';

/**
 * FilterResolverService — the ONE place a report filter is turned into
 * something a query can use.
 *
 * Three resolutions live here because each of them is a correctness trap that
 * would otherwise be re-implemented, slightly differently, ~250 times:
 *
 *  1. CAMPUS. `StudentProfile` has no `campusId` — campus hangs off
 *     `SchoolClass.campusId`, and the tenancy extension does NOT auto-scope it.
 *     Every campus filter must therefore resolve campus -> class ids first. One
 *     query that forgets, and campus A sees campus B's fee arrears.
 *
 *  2. CLASS BASIS. The live placement / the term's placements / the frozen academic
 *     roster are three different answers to "who is in P5", and they diverge the
 *     moment a pupil moves. Resolving here, and stamping the answer onto the
 *     report caption, is what stops the fee report and the results report
 *     disagreeing in silence.
 *
 *  3. ROW SCOPE. DataScopeService is the only authority on own/class/department;
 *     the resolved class list is intersected with it so a class teacher cannot
 *     widen a report by passing a classId they do not teach.
 *
 * It doubles as the school namespace's ReportContextBuilder — core cannot build
 * a context itself, since doing so needs these very tables.
 */
@Injectable()
export class FilterResolverService implements ReportContextBuilder {
  private readonly logger = new Logger('ReportFilterResolver');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly scope: DataScopeService,
    private readonly placements: PlacementLookupService,
  ) {}

  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  /** Class ids under a campus. Campus is not auto-scoped — this is the only hop. */
  async classIdsForCampus(campusId: string): Promise<string[]> {
    const rows = await this.db.schoolClass.findMany({
      where: { campusId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }

  async classIdsForGradeLevel(gradeLevelId: string): Promise<string[]> {
    const rows = await this.db.schoolClass.findMany({
      where: { gradeLevelId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }

  /**
   * Collapse classId / gradeLevelId / campusId into one concrete list, then
   * intersect with what the caller's data scope permits.
   *
   * Returns undefined for "no class restriction" — distinct from an empty array,
   * which means "restricted to nothing" and must yield an empty report rather
   * than a school-wide one.
   */
  async resolveClassIds(
    filters: { classId?: string; gradeLevelId?: string; campusId?: string },
    permitted: string[] | 'all',
  ): Promise<string[] | undefined> {
    const sets: string[][] = [];
    if (filters.classId) sets.push([filters.classId]);
    if (filters.gradeLevelId) sets.push(await this.classIdsForGradeLevel(filters.gradeLevelId));
    if (filters.campusId) sets.push(await this.classIdsForCampus(filters.campusId));

    let resolved: string[] | undefined;
    if (sets.length > 0) {
      // Intersection: campus=Main AND grade=P5 means P5 classes on the Main campus.
      resolved = sets.reduce((acc, cur) => acc.filter((id) => cur.includes(id)));
    }

    if (permitted === 'all') return resolved;
    // A narrower data scope always wins over a wider requested filter.
    return resolved ? resolved.filter((id) => permitted.includes(id)) : permitted;
  }

  /** The date window: explicit dates win, otherwise the term's own span. */
  async resolveWindow(
    filters: { dateFrom?: string; dateTo?: string; termId?: string },
  ): Promise<{ from: Date; to: Date } | undefined> {
    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date('1970-01-01');
      const to = filters.dateTo ? new Date(filters.dateTo) : new Date();
      if (from > to) {
        throw new BadRequestException('dateFrom must not be after dateTo');
      }
      // Inclusive of the whole end day — a register run "to 31 Aug" must include
      // the 31st, not stop at midnight on the 30th.
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }
    if (filters.termId) {
      const term = await this.db.term.findFirst({
        where: { id: filters.termId },
        select: { startDate: true, endDate: true },
      });
      if (term) return { from: term.startDate, to: term.endDate };
    }
    return undefined;
  }

  /** The current term, for reports that accept termId but were given none. */
  async currentTermId(): Promise<string | undefined> {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, deletedAt: null },
      select: { id: true },
    });
    return term?.id;
  }

  async academicYearForTerm(termId: string): Promise<string | undefined> {
    const term = await this.db.term.findFirst({
      where: { id: termId },
      select: { academicYearId: true },
    });
    return term?.academicYearId;
  }

  /** Build the context a definition runs against. */
  async build(
    def: ReportDefinition<any>,
    filters: Record<string, unknown>,
  ): Promise<ReportContext> {
    const f = filters as {
      classId?: string; gradeLevelId?: string; campusId?: string;
      termId?: string; academicYearId?: string; classBasis?: ClassBasis;
      dateFrom?: string; dateTo?: string; asOf?: string;
    };

    const [effective, permitted] = await Promise.all([
      this.scope.effective(),
      this.scope.classIds(),
    ]);

    const classIds = await this.resolveClassIds(f, permitted);
    const termId = f.termId ?? (def.filters.includes('termId') ? await this.currentTermId() : undefined);
    const academicYearId = f.academicYearId
      ?? (termId ? await this.academicYearForTerm(termId) : undefined);
    const window = await this.resolveWindow({ ...f, termId });

    // A 'current-only' report is pinned to now rather than pretending: the
    // underlying figures are current balances, and dating them into the past is
    // the mode FINANCIAL_INVARIANTS.md calls forbidden.
    const asOf = def.asOfMode === 'as-of' && f.asOf ? new Date(f.asOf) : new Date();

    return {
      organizationId: this.tenant.organizationId,
      userId: this.tenant.userId,
      scope: { effective, classIds: permitted },
      resolved: {
        classIds,
        termId,
        academicYearId,
        classBasis: (f.classBasis as ClassBasis) ?? def.classBasisDefault ?? 'current',
        window,
        asOf,
      },
      logger: { warn: (m: string) => this.logger.warn(`[${def.key}] ${m}`) },
    };
  }

  /** Classes with their capacity and labels, for utilisation reports. */
  async classesWithCapacity(classIds?: string[]): Promise<Array<{
    id: string; name: string; capacity: number;
    gradeLevelName: string; campusName: string;
  }>> {
    const rows = await this.db.schoolClass.findMany({
      where: { deletedAt: null, ...(classIds ? { id: { in: classIds } } : {}) },
      select: {
        id: true, name: true, capacity: true,
        gradeLevel: { select: { name: true } },
        campus: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((c: any) => ({
      id: c.id,
      name: c.name,
      capacity: c.capacity ?? 0,
      gradeLevelName: c.gradeLevel?.name ?? '',
      campusName: c.campus?.name ?? '',
    }));
  }

  /**
   * id -> admission number, name and current class, for reports whose canonical
   * service returns pupil ids only (fee balances are keyed by id, and a bursar
   * cannot chase an id).
   */
  async studentDirectory(studentProfileIds: string[]): Promise<Map<string, {
    admissionNo: string; name: string; className: string; classId: string | null;
  }>> {
    if (studentProfileIds.length === 0) return new Map();
    const found = await this.db.studentProfile.findMany({
      where: { id: { in: studentProfileIds } },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    // Class from placement history (ADR-027), not the StudentProfile projection.
    const rows = await this.placements.attach(found as Array<{ id: string }>);
    const classIds = [...new Set(rows.map((r) => r.placement?.classId).filter(Boolean) as string[])];
    const classNames = new Map<string, string>(
      classIds.length === 0
        ? []
        : (
            await this.db.schoolClass.findMany({
              where: { id: { in: classIds } },
              select: { id: true, name: true },
            })
          ).map((c: any) => [c.id, c.name]),
    );
    return new Map(rows.map((s: any) => [s.id, {
      admissionNo: s.admissionNo ?? '',
      name: s.partner?.name ?? s.admissionNo ?? s.id,
      className: s.placement ? (classNames.get(s.placement.classId) ?? '') : '',
      classId: s.placement?.classId ?? null,
    }]));
  }

  /** id -> subject name, for broadsheets and subject-performance reports. */
  async subjectNames(subjectIds: string[]): Promise<Map<string, string>> {
    if (subjectIds.length === 0) return new Map();
    const rows = await this.db.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return new Map(rows.map((r: any) => [r.id, r.name ?? r.code ?? r.id]));
  }

  /**
   * Student ids for a class list under the requested basis.
   *
   * Shared by every pupil-centric report so the three bases stay one
   * implementation. `roster` deliberately falls back to enrollment only when no
   * frozen roster exists for the term — a report that silently substitutes a
   * learner's CURRENT class for academic truth is the bug this whole type exists
   * to stop.
   *
   * Every basis reads placement history (ADR-027). `current` is the placement
   * open now; `enrollment` and `roster` are placements held during the term.
   * During the compatibility window a learner with no placement still resolves
   * through the legacy Enrollment row (term bases) or the projection (current).
   */
  async studentIdsFor(
    ctx: ReportContext,
    opts: { includeInactive?: boolean } = {},
  ): Promise<string[]> {
    const { classIds, termId, classBasis } = ctx.resolved;

    if (classBasis === 'enrollment' || classBasis === 'roster') {
      if (!termId) {
        throw new BadRequestException(
          `This report uses the "${classBasis}" class basis and needs a term. Select a term, or none is current.`,
        );
      }
      const placed = await this.placements.studentIdsIn(
        classIds ? { classIds } : {},
        { termId, includeInactive: opts.includeInactive },
      );
      // Compat: learners not yet backfilled are still counted from their legacy
      // term Enrollment. Removed with the legacy table (Phase 8).
      const legacy = await this.db.enrollment.findMany({
        where: {
          termId,
          ...(classIds ? { classId: { in: classIds } } : {}),
          ...(opts.includeInactive ? {} : { status: 'enrolled' }),
        },
        select: { studentProfileId: true },
      });
      return [
        ...new Set<string>([
          ...placed,
          ...legacy.map((r: { studentProfileId: string }) => r.studentProfileId),
        ]),
      ];
    }

    const rows = await this.db.studentProfile.findMany({
      where: {
        ...(classIds ? this.placements.studentWhere({ classIds }) : {}),
        ...(opts.includeInactive ? {} : { status: 'active' }),
        deletedAt: null,
      },
      select: { id: true },
    });
    return rows.map((r: { id: string }) => r.id);
  }
}
