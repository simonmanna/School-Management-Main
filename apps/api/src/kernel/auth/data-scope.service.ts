import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EmployeeIdentityService } from './employee-identity.service';
import { PortalIdentityService } from './portal-identity.service';

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
    const scope = await this.effective();
    if (scope === 'school') return 'all';
    const staffProfileId = await this.identity.staffProfileIdForCaller();
    if (!staffProfileId) return [];
    return this.taughtClassIds(staffProfileId);
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
    const [assigned, timetabled] = await Promise.all([
      this.db.teacherAssignment.findMany({
        where: { organizationId: this.tenant.organizationId, teacherPartnerId: staffProfileId },
        select: { classId: true },
      }),
      this.db.timetableSlot.findMany({
        where: { organizationId: this.tenant.organizationId, teacherPartnerId: staffProfileId },
        select: { classId: true },
      }),
    ]);
    const ids = new Set<string>();
    for (const r of [...assigned, ...timetabled]) if (r.classId) ids.add(r.classId);
    return [...ids];
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
