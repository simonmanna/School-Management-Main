import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EmployeeIdentityService } from './employee-identity.service';
import { PortalIdentityService } from './portal-identity.service';

/**
 * One place a restricted reader may look: a whole class (`sectionId` null) or
 * one stream of it. A reader's authority is a list of seats; an empty list is
 * no authority at all, never all of it (F07).
 */
export interface ReadSeat {
  classId: string;
  sectionId: string | null;
}

/** The four scopes, ordered from narrowest to widest. */
export const SCOPE_RANK: Record<string, number> = {
  own: 0,
  class: 1,
  department: 2,
  school: 3,
};

export function widestScope(a: string, b: string): string {
  const ra = SCOPE_RANK[a] ?? 0;
  const rb = SCOPE_RANK[b] ?? 0;
  return ra >= rb ? a : b;
}

/**
 * DataScopeService — the single authority for "WHERE can this role act?".
 *
 * Separates the data-scope dimension from the permission (WHAT) dimension:
 *   - permission answers "may I use this feature at all?"
 *   - data scope answers "which rows may I touch?"
 *
 * The widest scope across a user's roles wins (`own < class < department <
 * school`), mirroring how permissions already union across roles.
 *
 * Scope is read from the DATABASE role set per request (the guard already runs
 * in DB-lookup mode by default), never from a JWT snapshot — so a scope change
 * by an admin takes effect on the very next request, and a stale token cannot
 * keep a user at a wider scope than they now hold. `department` resolves
 * exclusively here (see `classIds`/`assertMayTouchClass`).
 *
 * This service is the ONLY place that decides what `own`/`class`/`department`
 * mean for the school vertical. No other service hand-rolls those checks.
 */
@Injectable()
export class DataScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly identity: EmployeeIdentityService,
    private readonly portal: PortalIdentityService,
  ) {}

  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  /** The caller's effective (widest) data scope, derived from their roles. */
  async effective(): Promise<string> {
    const roleScopes = await this.roleScopesForCaller();
    if (roleScopes.length === 0) return 'school'; // no role => default behaviour
    return roleScopes.reduce((acc, s) => widestScope(acc, s), 'own');
  }

  /** The caller's role dataScope values (may be empty). */
  private async roleScopesForCaller(): Promise<string[]> {
    const userId = this.tenant.userId;
    if (!userId) return [];
    const user = await this.db.user.findFirst({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) return [];
    // `dataScope` lives on Role; the generated client types it as the enum.
    return (user.roles as Array<{ dataScope?: string }>).map(
      (r) => r.dataScope ?? 'school',
    );
  }

  /** Class ids the caller may touch under a `class`/`department` scope. */
  async classIds(): Promise<string[] | 'all'> {
    const scope = await this.effective();
    if (scope === 'school' || scope === 'own') return 'all';

    const staffProfileId = await this.identity.staffProfileIdForCaller();
    if (!staffProfileId) return 'all'; // non-teaching staff with wide scope pass

    const ids = await this.taughtClassIds(staffProfileId);
    return ids.length > 0 ? ids : 'all';
  }

  /**
   * Classes whose pupils the caller may LIST (E2E audit R1, Wave 5). A
   * `school` scope reads everything; a `class`/`own` scope reads only the
   * classes the teacher actually teaches — definite, so a teacher with no
   * classes sees nobody rather than everybody.
   */
  async readableClassIds(): Promise<string[] | 'all'> {
    const seats = await this.readableSeats();
    if (seats === 'all') return 'all';
    return [...new Set(seats.map((s) => s.classId))];
  }

  /**
   * Where a restricted caller may read pupils, stream by stream (F09, ADR-031 D4):
   *   - a subject teacher: the class/stream of each of their assignments and
   *     course offerings in an open year, and their timetabled classes;
   *   - a homeroom (class) teacher: the whole class;
   *   - a stream class teacher: their stream, or the whole class when the
   *     school's `classTeacherScope` is CLASS.
   */
  async readableSeats(): Promise<ReadSeat[] | 'all'> {
    const scope = await this.effective();
    if (scope === 'school') return 'all';
    const staffProfileId = await this.identity.staffProfileIdForCaller();
    if (!staffProfileId) return [];
    return this.taughtSeats(staffProfileId);
  }

  private async taughtSeats(staffProfileId: string): Promise<ReadSeat[]> {
    const organizationId = this.tenant.organizationId;
    const openYear = { status: { in: ['PLANNING', 'ACTIVE'] } };
    const now = new Date();
    const [profile, assigned, timetabled, offerings, homeroom, streams] = await Promise.all([
      this.db.schoolProfile.findFirst({ where: { organizationId }, select: { classTeacherScope: true } }),
      this.db.teacherAssignment.findMany({
        where: { organizationId, teacherPartnerId: staffProfileId, OR: [{ termId: null }, { term: { academicYear: openYear } }] },
        select: { classId: true, sectionId: true },
      }),
      // A slot's year is its course offering's; an unlinked legacy slot counts
      // only while its class is active.
      this.db.timetableSlot.findMany({
        where: {
          organizationId,
          teacherPartnerId: staffProfileId,
          OR: [
            { courseOfferingId: null, schoolClass: { isActive: true } },
            { courseOffering: { deletedAt: null, academicYear: openYear } },
          ],
        },
        select: { classId: true, sectionId: true },
      }),
      this.db.courseOfferingTeacher.findMany({
        where: {
          organizationId,
          teacherPartnerId: staffProfileId,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          courseOffering: { deletedAt: null, academicYear: openYear },
        },
        select: { courseOffering: { select: { classId: true, sectionId: true } } },
      }),
      this.db.schoolClass.findMany({
        where: { organizationId, homeroomTeacherId: staffProfileId, isActive: true },
        select: { id: true },
      }),
      this.db.section.findMany({
        where: { organizationId, classTeacherId: staffProfileId, isActive: true, deletedAt: null },
        select: { id: true, classId: true },
      }),
    ]);
    const wholeClassForStreamTeacher = profile?.classTeacherScope === 'CLASS';
    const seats: ReadSeat[] = [
      ...assigned.map((a: any) => ({ classId: a.classId, sectionId: a.sectionId ?? null })),
      ...timetabled.map((t: any) => ({ classId: t.classId, sectionId: t.sectionId ?? null })),
      ...offerings
        .map((o: any) => o.courseOffering)
        .filter((o: any) => o?.classId)
        .map((o: any) => ({ classId: o.classId, sectionId: o.sectionId ?? null })),
      ...homeroom.map((c: any) => ({ classId: c.id, sectionId: null })),
      ...streams.map((s: any) => ({ classId: s.classId, sectionId: wholeClassForStreamTeacher ? null : s.id })),
    ];
    const whole = new Set(seats.filter((s) => !s.sectionId).map((s) => s.classId));
    const out = new Map<string, ReadSeat>();
    for (const s of seats) {
      if (!s.classId) continue;
      if (s.sectionId && whole.has(s.classId)) continue;
      out.set(`${s.classId}:${s.sectionId ?? ''}`, s);
    }
    return [...out.values()];
  }

  /**
   * A `StudentProfileWhereInput` fragment for the pupils the caller may read
   * now, or `null` when unrestricted. A restricted caller with no seats gets a
   * filter that matches nobody.
   */
  async studentReadWhere(): Promise<Record<string, unknown> | null> {
    const seats = await this.readableSeats();
    if (seats === 'all') return null;
    if (seats.length === 0) return { id: { in: [] as string[] } };
    return {
      academicEnrollments: {
        some: {
          status: { in: ['ACTIVE', 'PENDING', 'SUSPENDED'] },
          placements: {
            some: {
              effectiveTo: null,
              OR: seats.map((s) =>
                s.sectionId
                  ? { sectionId: s.sectionId, classCohort: { classId: s.classId } }
                  : { classCohort: { classId: s.classId } },
              ),
            },
          },
        },
      },
    };
  }

  /** Which of these pupils the caller may read; `'all'` when unrestricted. */
  async visibleStudentIds(studentProfileIds: string[]): Promise<Set<string> | 'all'> {
    const where = await this.studentReadWhere();
    if (where === null) return 'all';
    if (!studentProfileIds.length) return new Set();
    const rows = await this.db.studentProfile.findMany({
      where: { AND: [{ id: { in: studentProfileIds } }, where] },
      select: { id: true },
    });
    return new Set(rows.map((r: any) => r.id));
  }

  /** Throw unless the caller reads school-wide (results office work, not a class view). */
  async assertSchoolWide(): Promise<void> {
    if ((await this.readableSeats()) !== 'all') {
      throw new ForbiddenException('This is a school-wide view; you may only see the pupils you teach');
    }
  }

  /**
   * The classes this staff member actually teaches — assignments plus timetable.
   *
   * Returns a DEFINITE list: empty means "teaches nothing", never "teaches
   * everything". `classIds()` above still widens an empty result to `'all'`
   * because it feeds report filtering, where a head of department with no
   * personal timetable would otherwise see a blank dashboard. Authorization
   * must not make that trade, so it reads this instead.
   */
  private async taughtClassIds(staffProfileId: string): Promise<string[]> {
    const [assigned, timetabled, homeroom, sectionTeacher] = await Promise.all([
      // A class taught in a year that has since closed is not taught now
      // (re-audit #4): only term-less assignments and those in an open year count.
      this.db.teacherAssignment.findMany({
        where: {
          organizationId: this.tenant.organizationId,
          teacherPartnerId: staffProfileId,
          OR: [{ termId: null }, { term: { academicYear: { status: { in: ['PLANNING', 'ACTIVE'] } } } }],
        },
        select: { classId: true },
      }),
      this.db.timetableSlot.findMany({
        where: { organizationId: this.tenant.organizationId, teacherPartnerId: staffProfileId },
        select: { classId: true },
      }),
      // Re-audit #3 P1-15: the class teacher. A homeroom teacher with no
      // subject assignment or timetable row used to see none of their pupils.
      this.db.schoolClass.findMany({
        where: { organizationId: this.tenant.organizationId, homeroomTeacherId: staffProfileId, isActive: true },
        select: { id: true },
      }),
      this.db.section.findMany({
        where: { organizationId: this.tenant.organizationId, classTeacherId: staffProfileId, isActive: true, deletedAt: null },
        select: { classId: true },
      }),
    ]);
    const ids = new Set<string>();
    for (const r of [...assigned, ...timetabled, ...sectionTeacher]) if (r.classId) ids.add(r.classId);
    for (const r of homeroom) ids.add(r.id);
    return [...ids];
  }

  /**
   * Throw unless a class- or own-scoped caller teaches a class this pupil is
   * seated in now (re-audit #4). The list endpoint was scoped, but opening one
   * pupil by id, listing another class by id or reading one pupil's attendance
   * still returned anyone in the school.
   */
  async assertMayReadStudent(studentProfileId: string): Promise<void> {
    const visible = await this.visibleStudentIds([studentProfileId]);
    if (visible === 'all' || visible.has(studentProfileId)) return;
    throw new ForbiddenException('You may only open the records of pupils in classes you teach');
  }

  /**
   * Throw unless the caller may read (part of) this class. A stream-only reader
   * passes, and lists are then narrowed to their streams by `studentReadWhere`.
   */
  async assertMayReadClass(classId: string, sectionId?: string | null): Promise<void> {
    const seats = await this.readableSeats();
    if (seats === 'all') return;
    const ok = seats.some((s) => s.classId === classId && (!s.sectionId || !sectionId || s.sectionId === sectionId));
    if (!ok) throw new ForbiddenException('You may only list the pupils of classes you teach');
  }

  /** Throw unless the caller may act on this class under their scope. */
  async assertMayTouchClass(classId: string | null | undefined): Promise<void> {
    if (!classId) throw new ForbiddenException('A class id is required');
    const scope = await this.effective();
    if (scope === 'school') return;

    // `own` is the NARROWEST scope, and it used to return here alongside
    // `school` — so a Subject Teacher, whose preset is `dataScope: 'own'`,
    // could act on any class in the building. It must be at least as
    // restrictive as `class`, so it falls through to the same check.
    const staffProfileId = await this.identity.staffProfileIdForCaller();
    if (!staffProfileId) {
      throw new ForbiddenException('You may only act on classes you teach');
    }
    const allowed = await this.taughtClassIds(staffProfileId);
    if (!allowed.includes(classId)) {
      throw new ForbiddenException('You may only act on classes you teach');
    }
  }

  /**
   * Throw unless the caller personally teaches this class.
   *
   * Distinct from `assertMayTouchClass`, which asks what a role's data scope
   * permits. This asks the narrower question a `:own` grant actually makes:
   * the caller has claimed the class is theirs, so ownership is PROVED, never
   * assumed. An account with no staff record teaches nothing and is refused —
   * previously it fell through the role-scope default and was allowed.
   */
  async assertTeachesClass(classId: string | null | undefined): Promise<void> {
    if (!classId) throw new ForbiddenException('A class id is required');
    const staffProfileId = await this.identity.staffProfileIdForCaller();
    if (!staffProfileId) {
      throw new ForbiddenException('Only a member of teaching staff may act on a class');
    }
    const allowed = await this.taughtClassIds(staffProfileId);
    if (!allowed.includes(classId)) {
      throw new ForbiddenException('You may only act on classes you teach');
    }
  }

  /** Throw unless the caller may act on this student (delegates to portal identity). */
  async assertMayTouchStudent(studentProfileId: string): Promise<void> {
    if (!studentProfileId) throw new ForbiddenException('A student id is required');
    const ok = await this.portal.canAccessStudent(studentProfileId);
    if (!ok) {
      throw new ForbiddenException('Not permitted to view this student');
    }
  }

  /** Throw unless the caller owns (is) the given staff record. */
  async assertOwnsStaffRecord(staffProfileId: string): Promise<void> {
    if (!staffProfileId) throw new ForbiddenException('A staff id is required');
    const mine = await this.identity.staffProfileIdForCaller();
    if (mine && mine === staffProfileId) return;
    throw new ForbiddenException('You may only act on your own staff record');
  }

  /**
   * Privilege-escalation guard for role editing (review requirement): an actor
   * may only assign a scope no wider than their own widest scope. Administrator
   * (who holds everything, including `*`) is unrestricted — `effective()` for an
   * admin resolves to `school`, the widest value, so this always passes.
   */
  async canGrantScope(targetScope: string): Promise<boolean> {
    const actorWidest = await this.effective();
    return SCOPE_RANK[targetScope] <= SCOPE_RANK[actorWidest];
  }
}
