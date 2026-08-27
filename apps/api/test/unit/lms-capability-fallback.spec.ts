import { CapabilityService } from '../../src/modules/school/lms/moodle/context/capability.service';
import { CAP } from '../../src/modules/school/lms/moodle/capabilities';

/**
 * Coarse school permissions → LMS capabilities.
 *
 * The bug: capabilities came only from `LmsRoleAssignment`, and nothing seeds
 * those. On a fresh install `GET /school/lms/courses/:id` returned 403 to
 * everybody — including an administrator holding every `school:*` permission —
 * so the LMS was unusable out of the box.
 *
 * The fix must not reopen what it replaced. Two things are load-bearing:
 *   - `school:courses:teach` must NOT confer edit rights everywhere, or every
 *     teacher can edit every course, which is the scoping this system exists for;
 *   - an explicit `prohibit` must still win over any coarse grant.
 */
function build(opts: { permissions?: string[]; assignments?: any[]; roleCaps?: any[]; overrides?: any[] } = {}) {
  const { permissions = [], assignments = [], roleCaps = [], overrides = [] } = opts;

  const context = { id: 'ctx_course', organizationId: 'org_1', path: '/org-1/course-1/', depth: 1 };
  const prisma = {
    client: {
      lmsContext: {
        findFirst: jest.fn(async () => context),
        findMany: jest.fn(async () => [context]),
      },
      lmsRoleAssignment: { findMany: jest.fn(async () => assignments) },
      lmsRoleCapability: { findMany: jest.fn(async () => roleCaps) },
      lmsCapabilityOverride: { findMany: jest.fn(async () => overrides) },
    },
  } as any;
  const tenant = { organizationId: 'org_1', userId: 'u_admin', permissions } as any;
  const contexts = {
    ancestorIds: () => [context.id],
    ensureCourseContext: jest.fn(async () => context),
  } as any;
  return new CapabilityService(prisma, tenant, contexts);
}

const staff = { userId: 'u_admin' };

describe('LMS capability fallback from coarse permissions', () => {
  describe('the lockout', () => {
    it('gives an administrator full capabilities with no role assigned', async () => {
      const svc = build({ permissions: ['school:courses:write'] });
      await expect(svc.canAtCourse(staff, CAP.courseView, 'course_1')).resolves.toBe(true);
      await expect(svc.canAtCourse(staff, CAP.courseManageActivities, 'course_1')).resolves.toBe(true);
    });

    it('lets ordinary staff at least OPEN a course', async () => {
      // This is the exact 403 that was reported: a course page would not load.
      const svc = build({ permissions: ['school:read'] });
      await expect(svc.canAtCourse(staff, CAP.courseView, 'course_1')).resolves.toBe(true);
      await expect(svc.canAtCourse(staff, CAP.activityView, 'course_1')).resolves.toBe(true);
    });

    it('still denies someone with no school permissions at all', async () => {
      const svc = build({ permissions: [] });
      await expect(svc.canAtCourse(staff, CAP.courseView, 'course_1')).resolves.toBe(false);
    });
  });

  describe('what the fallback must NOT grant', () => {
    it('does not let plain staff edit a course', async () => {
      const svc = build({ permissions: ['school:read'] });
      await expect(svc.canAtCourse(staff, CAP.courseManageActivities, 'course_1')).resolves.toBe(false);
      await expect(svc.canAtCourse(staff, CAP.courseManage, 'course_1')).resolves.toBe(false);
    });

    it('does not let a teacher edit every course in the school', async () => {
      // `school:courses:teach` is deliberately absent from the mapping. Granting
      // it org-wide would undo the per-offering scoping entirely.
      const svc = build({ permissions: ['school:courses:teach'] });
      await expect(svc.canAtCourse(staff, CAP.courseManageActivities, 'course_1')).resolves.toBe(false);
    });

    it('does not give plain staff other pupils\' grades', async () => {
      const svc = build({ permissions: ['school:read'] });
      await expect(svc.canAtCourse(staff, CAP.gradeViewAll, 'course_1')).resolves.toBe(false);
      await expect(svc.canAtCourse(staff, CAP.assignViewSubmissions, 'course_1')).resolves.toBe(false);
    });

    it('grants a marker what marking needs, and no more', async () => {
      const svc = build({ permissions: ['school:grades:write'] });
      await expect(svc.canAtCourse(staff, CAP.gradeEdit, 'course_1')).resolves.toBe(true);
      await expect(svc.canAtCourse(staff, CAP.assignGrade, 'course_1')).resolves.toBe(true);
      // Marking does not imply restructuring the course.
      await expect(svc.canAtCourse(staff, CAP.courseManage, 'course_1')).resolves.toBe(false);
    });

    it('gives a student nothing from staff permissions', async () => {
      // A portal principal must never pick up a coarse staff grant.
      const svc = build({ permissions: ['school:courses:write'] });
      await expect(svc.canAtCourse({ studentProfileId: 'sp_1' }, CAP.courseManage, 'course_1')).resolves.toBe(false);
    });
  });

  describe('explicit assignments still take precedence', () => {
    it('an explicit prohibit beats a coarse grant', async () => {
      // Barring one person from one course must hold even for an administrator,
      // or the override mechanism is decorative.
      const svc = build({
        permissions: ['school:courses:write'],
        assignments: [{ roleId: 'r1', contextId: 'ctx_course', userId: 'u_admin' }],
        roleCaps: [{ roleId: 'r1', capability: CAP.courseManage, permission: 'prohibit' }],
      });
      await expect(svc.canAtCourse(staff, CAP.courseManage, 'course_1')).resolves.toBe(false);
      // Unrelated capabilities are untouched.
      await expect(svc.canAtCourse(staff, CAP.courseView, 'course_1')).resolves.toBe(true);
    });

    it('an assigned role adds to what the coarse permissions already allow', async () => {
      const svc = build({
        permissions: ['school:read'],
        assignments: [{ roleId: 'r1', contextId: 'ctx_course', userId: 'u_admin' }],
        roleCaps: [{ roleId: 'r1', capability: CAP.courseManageActivities, permission: 'allow' }],
      });
      await expect(svc.canAtCourse(staff, CAP.courseManageActivities, 'course_1')).resolves.toBe(true);
      await expect(svc.canAtCourse(staff, CAP.courseView, 'course_1')).resolves.toBe(true);
    });
  });

  describe('effectiveAtCourse', () => {
    it('reports the coarse grants, so the UI renders the right affordances', async () => {
      const svc = build({ permissions: ['school:courses:write'] });
      const eff = await svc.effectiveAtCourse(staff, 'course_1');
      expect(eff[CAP.courseView]).toBe(true);
      expect(eff[CAP.courseManageActivities]).toBe(true);
    });
  });
});
