import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Resolved staff identity for the caller: who they are across all three facets.
 *
 *     User ──1:1── HrEmployee ──1:1── Partner ──1:1── StaffProfile
 *
 * `staffProfileId` is what every teacher-scoped school endpoint keys on
 * (`TimetableSlot.teacherPartnerId`, `Assessment.teacherPartnerId`,
 * `LessonPlan.teacherPartnerId`, …). Before this existed there was NO join from
 * a logged-in user to their staff record, so those endpoints took the id from
 * the URL and trusted it.
 */
export interface EmployeeIdentity {
  userId: string;
  hrEmployeeId: string | null;
  partnerId: string | null;
  staffProfileId: string | null;
}

/**
 * EmployeeIdentityService — resolves a logged-in user to their staff records.
 *
 * Lives in the kernel deliberately. It reads tables owned by two different
 * verticals (`HrEmployee`, `StaffProfile`), which no vertical may import from
 * the other (ADR-011). The kernel is importable by everything and already sets
 * this precedent — `PortalIdentityService` reads `StudentProfile` /
 * `StudentGuardian` the same way.
 *
 * Resolution is per-request, never cached in the JWT. That is the same
 * deliberate trade-off documented on `PortalClaim`: a termination or a
 * re-assignment must take effect immediately, not at the end of a 15-minute
 * access token's life. The cost is one indexed lookup.
 *
 * Named `employee-identity` rather than `staff-identity` because
 * `kernel/auth/staff/` already exists and means RBAC user administration.
 */
@Injectable()
export class EmployeeIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Untyped delegate, mirroring `PortalIdentityService`: the generated client
   * is regenerated out-of-band because the dev API server holds the query
   * engine open on Windows.
   */
  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  /**
   * Resolve the caller (or an explicit user) to their staff identity.
   *
   * Returns nulls rather than throwing when the user has no employee record —
   * plenty of legitimate users (admins, bursars, portal parents) have none, and
   * callers decide whether that is a 403.
   */
  async forUser(userId?: string): Promise<EmployeeIdentity | null> {
    const uid = userId ?? this.tenant.userId;
    if (!uid) return null;

    const employee = await this.db.hrEmployee.findFirst({
      where: { userId: uid, deletedAt: null },
      select: { id: true, partnerId: true },
    });

    // An org may run the school vertical without HR. Fall back to resolving the
    // staff profile straight off the Partner when there is no HR record.
    if (!employee) {
      return { userId: uid, hrEmployeeId: null, partnerId: null, staffProfileId: null };
    }

    let staffProfileId: string | null = null;
    if (employee.partnerId) {
      const profile = await this.db.staffProfile.findFirst({
        where: { partnerId: employee.partnerId, deletedAt: null },
        select: { id: true },
      });
      staffProfileId = profile?.id ?? null;
    }

    return {
      userId: uid,
      hrEmployeeId: employee.id,
      partnerId: employee.partnerId ?? null,
      staffProfileId,
    };
  }

  /** The caller's own `StaffProfile.id`, or null when they are not staff. */
  async staffProfileIdForCaller(): Promise<string | null> {
    return (await this.forUser())?.staffProfileId ?? null;
  }

  /** The caller's own `HrEmployee.id`, or null. */
  async employeeIdForCaller(): Promise<string | null> {
    return (await this.forUser())?.hrEmployeeId ?? null;
  }

  /**
   * True when the caller IS the given teacher. Used by the ownership guard and
   * by handlers that accept a teacher id in the URL.
   */
  async isSelfTeacher(staffProfileId: string): Promise<boolean> {
    if (!staffProfileId) return false;
    const mine = await this.staffProfileIdForCaller();
    return !!mine && mine === staffProfileId;
  }

  /** True when the caller IS the given employee. */
  async isSelfEmployee(hrEmployeeId: string): Promise<boolean> {
    if (!hrEmployeeId) return false;
    const mine = await this.employeeIdForCaller();
    return !!mine && mine === hrEmployeeId;
  }

  /**
   * Guard a per-teacher route: allow an admin holding `adminPermission`, or the
   * teacher themselves. Throws otherwise.
   *
   * Coarse permissions like `school:read` say "may use the teacher workspace",
   * NOT "is that teacher" — several routes took the teacher id straight from
   * the URL, so any authenticated holder could read a colleague's classes,
   * lesson plans, availability and workload by changing it.
   */
  async assertIsTeacherOrAdmin(teacherPartnerId: string, adminPermission: string): Promise<void> {
    const perms: string[] = this.tenant.store?.permissions ?? [];
    if (perms.includes(adminPermission) || perms.includes('*')) return;
    if (teacherPartnerId && (await this.isSelfTeacher(teacherPartnerId))) return;
    throw new ForbiddenException('Not permitted to view this teacher\'s records');
  }
}
