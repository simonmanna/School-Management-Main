import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * Canonical read surface for report definitions (RPT-01 / plan item 9a).
 *
 * `report-definition-canon.spec.ts` forbids four things in
 * `reporting/definitions/*.reports.ts`: `amountResidual`, `payment.amount`,
 * `GradeEntry`, and `prisma.`. Seven files violated the last one, always the
 * same way — reaching through an injected service to its private client:
 *
 *     await (deps.timetable as any).prisma.client.timetableSlot.findMany({ ... })
 *
 * Those casts are not merely untidy. A report that assembles its own query is a
 * second implementation of a business question, and that is what produced the
 * dashboard-versus-statement divergence the spec header describes.
 *
 * This service holds the small set of *reference* reads the definitions need:
 * calendar, structure, timetable, curriculum, results metadata and GL entries.
 * It deliberately does NOT compute anything. Money still comes from
 * `SchoolFinanceQueryService`, marks still come from the result spine — a
 * lookup here must never become a place to re-derive a figure that an owning
 * service already answers.
 *
 * Every read goes through the tenant-scoped client, so organizationId is
 * injected by the tenancy extension rather than passed by the caller.
 */
@Injectable()
export class ReportLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get db() {
    return this.prisma.client as any;
  }

  // ── Academic calendar ────────────────────────────────────────────────────

  /** Terms of an academic year, in calendar order. */
  termsForYear(academicYearId: string) {
    return this.db.term.findMany({
      where: { academicYearId },
      orderBy: { startDate: 'asc' },
      include: { academicYear: true },
    });
  }

  // ── Structure ────────────────────────────────────────────────────────────

  subjectsByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.subject.findMany({ where: { id: { in: ids } } });
  }

  /** One class with the context a report caption needs. */
  classById(id: string) {
    return this.db.schoolClass.findFirst({
      where: { id },
      include: { gradeLevel: true, campus: true },
    });
  }

  classesByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.schoolClass.findMany({
      where: { id: { in: ids } },
      include: { gradeLevel: true },
    });
  }

  /** Periods of the timetable cycle, in teaching order. */
  periods() {
    return this.db.period.findMany({ orderBy: { order: 'asc' } });
  }

  // ── Timetable ────────────────────────────────────────────────────────────

  /**
   * Slots with the full teaching context (class, section, subject, teacher,
   * period, room). Used by the class grid, teacher schedule and coverage
   * reports.
   */
  timetableSlotsDetailed(filter: { teacherPartnerId?: string; classIds?: string[] }) {
    return this.db.timetableSlot.findMany({
      where: this.slotWhere(filter),
      include: {
        // The relation is `schoolClass`; a slot's room is either the managed
        // `teachingRoom` or the free-text `room` column. `class`/`room` as
        // relations make Prisma reject the whole query.
        schoolClass: { include: { gradeLevel: true } },
        section: true,
        subject: true,
        // `teacher` is a StaffProfile: its display name lives on Partner and
        // the workload report needs its department, so both are included.
        teacher: { include: { partner: true, department: true } },
        period: true,
        teachingRoom: true,
      },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }, { schoolClass: { name: 'asc' } }],
    });
  }

  /** Slots carrying only what room-utilisation needs — deliberately lean. */
  timetableSlotsForRooms(filter: { classIds?: string[] }) {
    return this.db.timetableSlot.findMany({
      where: this.slotWhere(filter),
      include: { teachingRoom: true, period: true },
    });
  }

  /** Slots for curriculum coverage: subject, teacher and period only. */
  timetableSlotsForCoverage(filter: { classIds?: string[] }) {
    return this.db.timetableSlot.findMany({
      where: this.slotWhere(filter),
      include: { subject: true, teacher: true, period: true },
    });
  }

  /**
   * Overrides in force on a date, with each override's subject resolved.
   *
   * The subject join was previously done by a helper in the definition file
   * that reached for the client a second time; folding it in here keeps the
   * "an override displays its subject" rule in one place.
   */
  async timetableOverridesOn(filter: { on: Date; teacherPartnerId?: string; classIds?: string[] }) {
    const rows = await this.db.timetableOverride.findMany({
      where: {
        ...this.slotWhere(filter),
        effectiveFrom: { lte: filter.on },
        effectiveTo: { gte: filter.on },
      },
    });
    const subjectIds = [...new Set(rows.map((o: any) => o.subjectId).filter(Boolean))] as string[];
    const subjects = await this.subjectsByIds(subjectIds);
    const byId = new Map<string, any>((subjects as any[]).map((s: any) => [s.id, s]));
    return rows.map((o: any) => ({ ...o, subject: o.subjectId ? byId.get(o.subjectId) ?? null : null }));
  }

  private slotWhere(filter: { teacherPartnerId?: string; classIds?: string[] }) {
    return {
      ...(filter.teacherPartnerId ? { teacherPartnerId: filter.teacherPartnerId } : {}),
      ...(filter.classIds?.length ? { classId: { in: filter.classIds } } : {}),
    };
  }

  // ── Curriculum ───────────────────────────────────────────────────────────

  /** Published curricula with their topics, for coverage reporting. */
  publishedCurricula(filter: { academicYearId: string; classIds?: string[] }) {
    return this.db.curriculum.findMany({
      where: {
        academicYearId: filter.academicYearId,
        ...(filter.classIds?.length ? { classId: { in: filter.classIds } } : {}),
        status: 'published',
      },
      // `Curriculum` holds a loose `classId` with no Prisma relation, so the
      // class must be resolved separately via classesByIds.
      include: { topics: { orderBy: { order: 'asc' } } },
    });
  }

  /** Lesson plans that represent teaching actually signed off. */
  lessonPlans(filter: { classIds?: string[]; termId?: string | null; statuses?: string[] }) {
    return this.db.lessonPlan.findMany({
      where: {
        ...(filter.classIds?.length ? { classId: { in: filter.classIds } } : {}),
        ...(filter.termId ? { termId: filter.termId } : {}),
        status: { in: filter.statuses ?? ['approved', 'archived'] },
      },
      // `LessonPlan` has a `subject` relation but only a loose `classId`, so
      // asking for `class` here makes the whole query invalid.
      include: { subject: true },
    });
  }

  // ── Results metadata ─────────────────────────────────────────────────────

  /** Issued report cards, newest first, so callers can take the latest per pupil. */
  reportCards(filter: { termId?: string; studentProfileIds?: string[] }) {
    return this.db.reportCard.findMany({
      where: {
        ...(filter.termId ? { termId: filter.termId } : {}),
        ...(filter.studentProfileIds?.length
          ? { studentProfileId: { in: filter.studentProfileIds } }
          : {}),
      },
      orderBy: { generatedAt: 'desc' },
    });
  }

  /**
   * Published class-scoped result sets for a term, newest revision first.
   *
   * Only `published` sets: a draft or under-review set is not a result a report
   * may show. Ordering by revision descending lets a caller take the first hit
   * per class as the current one.
   */
  publishedClassResultSets(filter: { termId: string; classIds: string[] }) {
    return this.db.resultSet.findMany({
      where: {
        termId: filter.termId,
        scopeType: 'class',
        scopeId: { in: filter.classIds },
        status: 'published',
      },
      include: { termResults: true, subjectResults: true },
      orderBy: { revision: 'desc' },
    });
  }

  // ── General ledger ───────────────────────────────────────────────────────

  /**
   * Posting-date filter. Mirrors `AccountingReportingService.rangeFilter`
   * exactly — the definitions used to call that private method by string index.
   */
  private postingDateFilter(range: { from?: string; to?: string }) {
    const f: Record<string, Date> = {};
    if (range.from) f.gte = new Date(range.from);
    if (range.to) f.lte = new Date(range.to);
    return f;
  }

  /** One page of journal entries, plus the unpaged total for the caption. */
  async journalEntriesPage(filter: {
    from?: string;
    to?: string;
    statuses: string[];
    page: number;
    pageSize: number;
  }) {
    const where = {
      status: { in: filter.statuses },
      postingDate: this.postingDateFilter(filter),
    };
    const [entries, total] = await Promise.all([
      this.db.journalEntry.findMany({
        where,
        include: { journal: true, lines: { include: { account: true } } },
        orderBy: { postingDate: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.db.journalEntry.count({ where }),
    ]);
    return { entries, total };
  }

  /** Entries in a range with their lines — used by the reversal report. */
  journalEntriesWithLines(filter: { from?: string; to?: string; statuses: string[] }) {
    return this.db.journalEntry.findMany({
      where: {
        status: { in: filter.statuses },
        postingDate: this.postingDateFilter(filter),
      },
      include: { lines: true },
      orderBy: { postingDate: 'desc' },
    });
  }

  /**
   * The reversal entries behind a set of ids. A reversal is a separate entry
   * reached by `reversedEntryId`, not fields on the original.
   */
  journalEntrySummaries(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.journalEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, entryNumber: true, postedBy: true, createdBy: true, description: true },
    });
  }

  // ── Fiscal periods ───────────────────────────────────────────────────────

  fiscalPeriods(filter: { from?: string; to?: string }) {
    return this.db.fiscalPeriod.findMany({
      where: {
        ...(filter.from ? { startDate: { gte: new Date(filter.from) } } : {}),
        ...(filter.to ? { endDate: { lte: new Date(filter.to) } } : {}),
      },
      orderBy: { startDate: 'asc' },
    });
  }

  /** The fiscal period covering an instant, if any. */
  fiscalPeriodCovering(asOf: Date) {
    return this.db.fiscalPeriod.findFirst({
      where: { startDate: { lte: asOf }, endDate: { gte: asOf } },
    });
  }

  /**
   * Book-lock settings for the current organization.
   *
   * `Organization` is deliberately absent from ORG_SCOPED, so this reads the
   * tenant id explicitly rather than relying on the extension to scope it.
   */
  bookLockSettings() {
    return this.prisma.raw.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: { booksLockDate: true, requireFiscalPeriod: true },
    });
  }
}
