import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/**
 * Where a learner actually is, according to placement history (ADR-018).
 *
 * There is no "current class" column on a student. Which class and stream a
 * learner sits in — now, or on 14 March of last year — is answered from the
 * effective-dated `EnrollmentPlacement` rows under their `StudentEnrollment`.
 * This service is the one reader every module uses for that question: fees,
 * meals, statutory exports, mark sheets, reports, portals and messaging.
 *
 * `studentWhere` is the important one. Most callers are filters, not lookups —
 * "learners in P4" — so it hands back a composable Prisma fragment rather than
 * forcing a fetch-then-filter. `resolve`/`attach`/`describe` answer the lookup
 * form, batched: one query for N learners.
 */

/** Where one learner sits at a point in time. */
export interface ResolvedPlacement {
  enrollmentId: string;
  placementId: string;
  classCohortId: string;
  classId: string;
  sectionId: string | null;
  gradeLevelId: string;
  academicYearId: string;
  termId: string;
  rollNumber: string | null;
}

/** Which part of the structure to match. Omitted keys are not constrained. */
export interface PlacementTarget {
  classIds?: string[];
  cohortIds?: string[];
  sectionIds?: string[];
  gradeLevelIds?: string[];
}

export interface PlacementAt {
  /** Point in time. Defaults to now. */
  asOf?: Date;
  /** Narrow to one term. Use when the caller is already term-scoped, e.g. billing. */
  termId?: string;
  academicYearId?: string;
  /** Include placements of enrollments that no longer hold a seat. Default false. */
  includeInactive?: boolean;
  /**
   * Run outside a tenant context against this organization, using the raw
   * client with an explicit `organizationId` filter. For callers that are not
   * request-scoped — the messaging audience resolver runs from subscribers and
   * cron — where the tenant-scoped client would throw "no tenant context".
   */
  organizationId?: string;
}

@Injectable()
export class PlacementLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant-scoped client normally; the raw client plus an explicit org filter when asked. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db(at: PlacementAt): any {
    return at.organizationId ? this.prisma.raw : this.prisma.client;
  }

  private org(at: PlacementAt): Record<string, unknown> {
    return at.organizationId ? { organizationId: at.organizationId } : {};
  }

  /**
   * The effective-dating predicate, shared by every query here.
   *
   * A placement covers `asOf` when it started on or before it and has either not
   * ended or ended after it. Closed rows are therefore included when asking
   * about the past, which is the entire point — a learner who left in April was
   * still in P4 North in March.
   */
  private effectiveAt(at: PlacementAt): Record<string, unknown> {
    // A TERM-scoped question with no explicit date means "placed at any point in
    // that term". Applying "effective as of now" on top of it would exclude every
    // placement closed at the end of a past term, so asking about last term
    // found nobody and quietly fell back to today's class. When the caller gives
    // both a term and a date, both apply.
    const dateWindow =
      at.termId && !at.asOf
        ? {}
        : (() => {
            const asOf = at.asOf ?? new Date();
            return {
              effectiveFrom: { lte: asOf },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
            };
          })();
    return {
      ...dateWindow,
      ...(at.termId ? { termId: at.termId } : {}),
      ...(at.academicYearId ? { enrollment: { academicYearId: at.academicYearId } } : {}),
    };
  }

  /** Structure constraints, expressed against EnrollmentPlacement. */
  private targetWhere(target: PlacementTarget): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (target.cohortIds?.length) where.classCohortId = { in: target.cohortIds };
    if (target.sectionIds?.length) where.sectionId = { in: target.sectionIds };
    if (target.classIds?.length || target.gradeLevelIds?.length) {
      where.classCohort = {
        ...(target.classIds?.length ? { classId: { in: target.classIds } } : {}),
        ...(target.gradeLevelIds?.length
          ? { schoolClass: { gradeLevelId: { in: target.gradeLevelIds } } }
          : {}),
      };
    }
    return where;
  }

  /** Enrollment statuses that hold a class seat. */
  /**
   * Which memberships count.
   *
   *  - A HISTORICAL question (an explicit date or a term) is answered by the
   *    placement's own effective dates: a learner who later withdrew, transferred
   *    or completed WAS in P4 North last March, and must be found. Only a
   *    CANCELLED enrollment (created in error) never counts.
   *  - A question about NOW counts every membership that holds a seat, including
   *    SUSPENDED — a suspended pupil stays on the class roll (enrollment-fsm).
   */
  private statusClause(at: PlacementAt): Record<string, unknown> {
    if (at.includeInactive) return {};
    if (at.asOf || at.termId) return { status: { not: 'CANCELLED' } };
    return { status: { in: ['ACTIVE', 'PENDING', 'SUSPENDED'] } };
  }

  private enrollmentWhere(at: PlacementAt): Record<string, unknown> {
    const clause = this.statusClause(at);
    return Object.keys(clause).length ? { enrollment: clause } : {};
  }

  /** The enrollment filter for a placement query: status plus the year, merged (not overwritten). */
  private enrollmentFilter(at: PlacementAt, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const merged = {
      ...this.statusClause(at),
      ...(at.academicYearId ? { academicYearId: at.academicYearId } : {}),
      ...extra,
    };
    return Object.keys(merged).length ? { enrollment: merged } : {};
  }

  /**
   * A `StudentProfileWhereInput` fragment selecting learners placed in `target`.
   *
   *   where: { status: 'active', ...placementLookup.studentWhere({ classIds: [x] }) }
   *
   * Returns `{}` when the target constrains nothing, so a caller that only
   * sometimes filters by class does not need a branch.
   */
  studentWhere(target: PlacementTarget, at: PlacementAt = {}): Prisma.StudentProfileWhereInput {
    const constraints = this.targetWhere(target);
    if (Object.keys(constraints).length === 0 && !at.termId && !at.academicYearId) return {};
    const enrollment = this.enrollmentWhere(at);
    return {
      academicEnrollments: {
        some: {
          ...(enrollment.enrollment as Record<string, unknown> | undefined),
          placements: { some: { ...this.effectiveAt(at), ...constraints } },
        },
      },
    } as Prisma.StudentProfileWhereInput;
  }

  /**
   * Resolve where each learner sits, batched.
   *
   * One query for N learners, so no caller needs a per-student loop.
   */
  async resolve(
    studentProfileIds: string[],
    at: PlacementAt = {},
  ): Promise<Map<string, ResolvedPlacement>> {
    const out = new Map<string, ResolvedPlacement>();
    if (studentProfileIds.length === 0) return out;

    const rows = await this.db(at).enrollmentPlacement.findMany({
      where: {
        ...this.org(at),
        ...this.effectiveAt(at),
        ...this.enrollmentFilter(at, { studentProfileId: { in: studentProfileIds } }),
      },
      // Newest first, so the first row seen per learner wins when a correction
      // left two rows covering the same instant.
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        enrollmentId: true,
        termId: true,
        classCohortId: true,
        sectionId: true,
        rollNumber: true,
        classCohort: { select: { classId: true, academicYearId: true } },
        enrollment: { select: { studentProfileId: true, gradeLevelId: true } },
      },
    });

    for (const r of rows) {
      const sid = r.enrollment.studentProfileId;
      if (out.has(sid)) continue;
      out.set(sid, {
        enrollmentId: r.enrollmentId,
        placementId: r.id,
        classCohortId: r.classCohortId,
        classId: r.classCohort.classId,
        sectionId: r.sectionId,
        gradeLevelId: r.enrollment.gradeLevelId,
        academicYearId: r.classCohort.academicYearId,
        termId: r.termId,
        rollNumber: r.rollNumber,
      });
    }
    return out;
  }

  /** The learners placed in `target`. */
  async studentIdsIn(target: PlacementTarget, at: PlacementAt = {}): Promise<string[]> {
    const rows = await this.db(at).enrollmentPlacement.findMany({
      where: {
        ...this.org(at),
        ...this.effectiveAt(at),
        ...this.targetWhere(target),
        ...this.enrollmentFilter(at),
      },
      select: { enrollment: { select: { studentProfileId: true } } },
      distinct: ['enrollmentId'],
    });
    return [
      ...new Set<string>(
        (rows as Array<{ enrollment: { studentProfileId: string } }>).map((r) => r.enrollment.studentProfileId),
      ),
    ];
  }

  /**
   * Attach resolved placements to already-loaded student rows.
   *
   * For services that load students and then read the class in several places
   * further down: `student.placement.classId`, without a Map lookup each time.
   */
  async attach<T extends { id: string }>(
    students: T[],
    at: PlacementAt = {},
  ): Promise<Array<T & { placement: ResolvedPlacement | null }>> {
    const byId = await this.resolve(
      students.map((s) => s.id),
      at,
    );
    return students.map((s) => ({ ...s, placement: byId.get(s.id) ?? null }));
  }

  /**
   * An active class roster — the learners placed in `target`, each with their
   * placement and its stream (section) name.
   */
  async roster(target: PlacementTarget, at: PlacementAt = {}) {
    const where = this.studentWhere(target, at);
    if (Object.keys(where).length === 0) return [];
    const students = await this.prisma.client.studentProfile.findMany({
      where: { status: 'active', ...where },
      include: { partner: true },
    });
    const placed = await this.attach(students, at);

    const sectionIds = [...new Set(placed.map((s) => s.placement?.sectionId).filter(Boolean) as string[])];
    const names = new Map<string, string>(
      sectionIds.length === 0
        ? []
        : (
            await this.prisma.client.section.findMany({
              where: { id: { in: sectionIds } },
              select: { id: true, name: true },
            })
          ).map((x) => [x.id, x.name]),
    );

    return placed.map((s) => {
      const sectionId = s.placement?.sectionId ?? null;
      return {
        student: s,
        placement: s.placement,
        sectionId,
        sectionName: sectionId ? (names.get(sectionId) ?? null) : null,
      };
    });
  }

  /**
   * Display names for where each learner sits: class, grade and stream (section).
   * Report cards, statutory exports, fee statements and dashboards all want
   * exactly this, so they share one query plan.
   */
  async describe(
    studentProfileIds: string[],
    at: PlacementAt = {},
  ): Promise<
    Map<
      string,
      {
        classId: string | null;
        className: string | null;
        gradeLevelId: string | null;
        gradeLevelName: string | null;
        sectionId: string | null;
        sectionName: string | null;
      }
    >
  > {
    const out = new Map();
    if (studentProfileIds.length === 0) return out;
    const resolved = await this.resolve(studentProfileIds, at);
    const placements = [...resolved.values()];
    const classIds = [...new Set(placements.map((p) => p.classId))];
    const sectionIds = [...new Set(placements.map((p) => p.sectionId).filter(Boolean) as string[])];
    const db = this.db(at);
    const [classes, sections] = await Promise.all([
      classIds.length
        ? db.schoolClass.findMany({
            where: { ...this.org(at), id: { in: classIds } },
            select: { id: true, name: true, gradeLevelId: true, gradeLevel: { select: { name: true } } },
          })
        : Promise.resolve([]),
      sectionIds.length
        ? db.section.findMany({ where: { ...this.org(at), id: { in: sectionIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const classById = new Map<string, any>((classes as any[]).map((c) => [c.id, c]));
    const sectionById = new Map<string, any>((sections as any[]).map((s) => [s.id, s]));
    for (const id of studentProfileIds) {
      const p = resolved.get(id);
      const cls = p ? classById.get(p.classId) : null;
      const sec = p?.sectionId ? sectionById.get(p.sectionId) : null;
      out.set(id, {
        classId: p?.classId ?? null,
        className: cls?.name ?? null,
        gradeLevelId: cls?.gradeLevelId ?? p?.gradeLevelId ?? null,
        gradeLevelName: cls?.gradeLevel?.name ?? null,
        sectionId: p?.sectionId ?? null,
        sectionName: sec?.name ?? null,
      });
    }
    return out;
  }

  /** Active learners per class, from placement history — for class-size figures. */
  async classSizes(classIds: string[], at: PlacementAt = {}): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (classIds.length === 0) return out;

    const placed = await this.db(at).enrollmentPlacement.findMany({
      where: {
        ...this.org(at),
        ...this.effectiveAt(at),
        classCohort: { classId: { in: classIds } },
        // A seat is a seat: suspended learners still occupy one.
        ...this.enrollmentFilter(at, { student: { status: { in: ['active', 'suspended'] } } }),
      },
      select: {
        classCohort: { select: { classId: true } },
        enrollment: { select: { studentProfileId: true } },
      },
    });
    const seen = new Map<string, Set<string>>();
    for (const p of placed as Array<{ classCohort: { classId: string }; enrollment: { studentProfileId: string } }>) {
      const set = seen.get(p.classCohort.classId) ?? new Set<string>();
      set.add(p.enrollment.studentProfileId);
      seen.set(p.classCohort.classId, set);
    }
    for (const [classId, set] of seen) out.set(classId, set.size);
    return out;
  }
}
