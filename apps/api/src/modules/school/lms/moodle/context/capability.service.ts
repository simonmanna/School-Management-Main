import { ALL_CAPABILITIES, CAP } from '../capabilities';
import { Injectable } from '@nestjs/common';
import type { LmsContext, LmsPermission } from '@prisma/client';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { LmsContextService } from './context.service';

export interface Principal {
  userId?: string;
  studentProfileId?: string;
}

function principalKey(p: Principal): string {
  return p.userId ? `u:${p.userId}` : p.studentProfileId ? `s:${p.studentProfileId}` : 'anon';
}

/**
 * Capability resolver (ADR-014 §3.1). Given a principal and a target context, folds
 * role-default capabilities and per-context overrides along the ancestor path:
 *
 *   prohibit anywhere  → deny, permanently
 *   else nearest (deepest) context's non-`inherit` setting wins
 *   else deny
 *
 * Results are memoised per (org, principal, context) and invalidated by bumping the
 * org's cache version on any role/assignment/override write.
 */

/**
 * Coarse school permissions → LMS capabilities held org-wide.
 *
 * Moodle grants a system-level role its capabilities at every context beneath it.
 * Without an equivalent, this installation locked everyone out: capabilities come
 * only from `LmsRoleAssignment`, nothing seeds those assignments, and a fresh
 * course therefore denied even a full administrator the right to open it.
 *
 * The two layers compose rather than compete:
 *   - a coarse permission says WHAT a staff member may do across the school;
 *   - an `LmsRoleAssignment` says WHICH course a person is attached to.
 *
 * So `school:courses:write` — a registrar-grade grant — confers manager
 * capabilities everywhere, while `school:courses:teach` deliberately does NOT:
 * letting every teacher edit every course is exactly the scoping this system
 * exists to provide.
 */
const PERMISSION_CAPABILITIES: Array<{ permission: string; capabilities: readonly string[] }> = [
  // Administers courses org-wide.
  { permission: 'school:courses:write', capabilities: ALL_CAPABILITIES },
  // Marks work: needs to open a course and write grades in it.
  {
    permission: 'school:grades:write',
    capabilities: [
      CAP.courseView, CAP.activityView, CAP.gradeView, CAP.gradeViewAll, CAP.gradeEdit,
      CAP.courseViewParticipants, CAP.assignViewSubmissions, CAP.assignGrade, CAP.quizGrade,
      CAP.courseViewReports, CAP.completionOverride,
    ],
  },
  // Enrols learners.
  { permission: 'school:courses:enrol', capabilities: [CAP.courseView, CAP.courseEnrol, CAP.courseViewParticipants] },
  // Plain staff read. Enough to open a course page; per-pupil data is gated
  // separately by the capabilities above, so this does not leak anyone's work.
  { permission: 'school:lms:read', capabilities: [CAP.courseView, CAP.activityView] },
  { permission: 'school:read', capabilities: [CAP.courseView, CAP.activityView] },
];

@Injectable()
export class CapabilityService {
  private readonly cache = new Map<string, { version: number; caps: Map<string, LmsPermission> }>();
  private readonly orgVersion = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly contexts: LmsContextService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Invalidate everything for the current org (call after any role/assignment/override mutation). */
  bust(): void {
    this.orgVersion.set(this.org, (this.orgVersion.get(this.org) ?? 0) + 1);
  }

  private version(): number {
    return this.orgVersion.get(this.org) ?? 0;
  }

  /** True iff the principal is allowed the capability at the given context. */
  async can(principal: Principal, capability: string, contextId: string): Promise<boolean> {
    const caps = await this.resolveAll(principal, contextId);
    return caps.get(capability) === 'allow';
  }

  /** Convenience: check at a course's context (resolving/creating it as needed). */
  async canAtCourse(principal: Principal, capability: string, courseOfferingId: string): Promise<boolean> {
    const ctx = await this.contexts.ensureCourseContext(courseOfferingId);
    return this.can(principal, capability, ctx.id);
  }

  /** The full capability→permission map at a context — drives the UI's effective-permissions endpoint. */
  async effective(principal: Principal, contextId: string): Promise<Record<string, boolean>> {
    const caps = await this.resolveAll(principal, contextId);
    const out: Record<string, boolean> = {};
    for (const [cap, perm] of caps) out[cap] = perm === 'allow';
    return out;
  }

  /** Effective capabilities at a course's context (resolving/creating it as needed). */
  async effectiveAtCourse(principal: Principal, courseOfferingId: string): Promise<Record<string, boolean>> {
    const ctx = await this.contexts.ensureCourseContext(courseOfferingId);
    return this.effective(principal, ctx.id);
  }


  /**
   * Capabilities a staff principal holds from their coarse school permissions.
   *
   * Students and guardians get nothing here: their access is scoped by
   * enrolment and guardianship, never by a school-wide permission.
   */
  private fromPermissions(principal: Principal): Map<string, LmsPermission> {
    const caps = new Map<string, LmsPermission>();
    if (!principal.userId) return caps;
    const held = new Set(this.tenant.permissions);
    for (const { permission, capabilities } of PERMISSION_CAPABILITIES) {
      if (!held.has(permission)) continue;
      for (const cap of capabilities) caps.set(cap, 'allow');
    }
    return caps;
  }

  private async resolveAll(principal: Principal, contextId: string): Promise<Map<string, LmsPermission>> {
    const key = `${this.org}:${principalKey(principal)}:${contextId}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === this.version()) return cached.caps;

    const target = await this.prisma.client.lmsContext.findFirst({
      where: { id: contextId, organizationId: this.org },
    });
    const empty = new Map<string, LmsPermission>();
    if (!target) {
      this.cache.set(key, { version: this.version(), caps: empty });
      return empty;
    }

    const ancestorIds = this.contexts.ancestorIds(target);
    const ancestors = await this.prisma.client.lmsContext.findMany({
      where: { id: { in: ancestorIds }, organizationId: this.org },
      orderBy: { depth: 'asc' },
    });
    const depthOf = new Map<string, number>(ancestors.map((a: LmsContext) => [a.id, a.depth]));

    // Assignments this principal holds at any ancestor context.
    const assignments = await this.prisma.client.lmsRoleAssignment.findMany({
      where: {
        organizationId: this.org,
        contextId: { in: ancestorIds },
        ...(principal.userId
          ? { userId: principal.userId }
          : { studentProfileId: principal.studentProfileId ?? '__none__' }),
      },
    });
    // A staff member's coarse permissions grant capabilities org-wide, exactly
    // as a Moodle system role would. Without this, an installation that has
    // never assigned an LMS role — which is every fresh one — denies everybody,
    // including an administrator, the right to open a course.
    const implicit = this.fromPermissions(principal);

    if (assignments.length === 0) {
      this.cache.set(key, { version: this.version(), caps: implicit });
      return implicit;
    }

    const roleIds = Array.from(new Set(assignments.map((a) => a.roleId)));
    // Depth at which each role first takes effect (min over its assignment contexts).
    const roleEffectiveDepth = new Map<string, number>();
    for (const a of assignments) {
      const d = depthOf.get(a.contextId) ?? 0;
      roleEffectiveDepth.set(a.roleId, Math.min(roleEffectiveDepth.get(a.roleId) ?? Infinity, d));
    }

    const [defaults, overrides] = await Promise.all([
      this.prisma.client.lmsRoleCapability.findMany({ where: { roleId: { in: roleIds } } }),
      this.prisma.client.lmsCapabilityOverride.findMany({
        where: { roleId: { in: roleIds }, contextId: { in: ancestorIds } },
      }),
    ]);

    const defaultOf = new Map<string, LmsPermission>(); // `${roleId}|${cap}`
    for (const d of defaults) defaultOf.set(`${d.roleId}|${d.capability}`, d.permission);
    const overrideOf = new Map<string, LmsPermission>(); // `${roleId}|${ctxId}|${cap}`
    for (const o of overrides) overrideOf.set(`${o.roleId}|${o.contextId}|${o.capability}`, o.permission);

    const allCaps = new Set<string>([...defaults.map((d) => d.capability), ...overrides.map((o) => o.capability)]);

    const result = new Map<string, LmsPermission>();
    for (const cap of allCaps) {
      let verdict: LmsPermission = 'inherit';
      let prohibited = false;
      for (const ctx of ancestors) {
        for (const roleId of roleIds) {
          if ((roleEffectiveDepth.get(roleId) ?? Infinity) > ctx.depth) continue; // role not yet in effect here
          const perm =
            overrideOf.get(`${roleId}|${ctx.id}|${cap}`) ?? defaultOf.get(`${roleId}|${cap}`) ?? 'inherit';
          if (perm === 'prohibit') prohibited = true;
          else if (perm !== 'inherit') verdict = perm;
        }
      }
      result.set(cap, prohibited ? 'prohibit' : verdict);
    }

    // An explicit `prohibit` still wins: it is the one verdict that cannot be
    // overridden from above, so a person barred from one course stays barred
    // even if their coarse permissions would otherwise allow it.
    for (const [cap, perm] of implicit) {
      if (result.get(cap) === 'prohibit') continue;
      if (perm === 'allow' && result.get(cap) !== 'allow') result.set(cap, 'allow');
    }

    this.cache.set(key, { version: this.version(), caps: result });
    return result;
  }
}
