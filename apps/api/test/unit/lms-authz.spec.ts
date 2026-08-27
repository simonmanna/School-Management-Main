import { ForbiddenException } from '@nestjs/common';
import { CourseModuleService } from '../../src/modules/school/lms/moodle/course/module.service';
import { PortalIdentityService } from '../../src/kernel/auth/portal-identity.service';
import type { PortalClaim } from '../../src/kernel/auth/portal-identity.types';

/**
 * L0.1/L0.2 — LMS authorization regression suite.
 *
 * Two holes this pins shut, both previously reachable by editing a URL:
 *
 *  1. IMPERSONATION — `GET modules/:id/view?studentProfileId=<someone else>` served
 *     that student's submissions and quiz attempts, and `markViewed` ticked their
 *     completion. `POST modules/:id/action/*` took the id from the BODY, so a
 *     student could submit work as a classmate.
 *  2. ESCALATION BY OMISSION — dropping the parameter fell through to
 *     `viewForTeacher`, handing over submission lists and answer keys, AND skipped
 *     the availability check because it lived inside `if (studentProfileId)`.
 */

const COURSE_MODULE = {
  id: 'cm_1',
  courseOfferingId: 'course_1',
  sectionId: 'sec_1',
  activityType: 'quiz',
  instanceId: 'inst_1',
  completionMode: 'automatic',
  completionRules: {},
  availability: null,
  deletedAt: null,
};

function build(opts: {
  claim?: PortalClaim;
  guardianships?: Array<{ studentProfileId: string; guardianContactId: string }>;
  capabilities?: string[];
  available?: boolean;
}) {
  const { claim, guardianships = [], capabilities = [], available = true } = opts;

  const studentGuardian = {
    findFirst: jest.fn(async (args: any) => {
      const ids: string[] = args.where.guardianContactId?.in ?? [];
      const hit = guardianships.find(
        (g) => g.studentProfileId === args.where.studentProfileId && ids.includes(g.guardianContactId),
      );
      return hit ? { id: 'link' } : null;
    }),
    findMany: jest.fn(async () => []),
  };

  const cmRow = COURSE_MODULE;
  const prisma = {
    client: {
      courseModule: { findFirst: jest.fn(async () => COURSE_MODULE) },
      studentGuardian,
      learningObjectiveEvidence: { create: jest.fn() },
    },
    raw: { portalIdentity: { findMany: jest.fn(async () => []) } },
  } as any;

  const tenant = { organizationId: 'org_1', userId: 'user_1', portal: claim } as any;
  const portalIdentity = new PortalIdentityService(prisma, tenant);

  // Params are declared so `mock.calls[0][0]` is typed — the assertions below
  // check WHICH subject the spine handed the plugin, which is the whole point.
  const studentView = jest.fn(async (_ctx: any, _cm: any) => ({ view: 'student' }));
  const teacherView = jest.fn(async (_ctx: any, _cm: any) => ({ view: 'teacher', submissions: ['everyone'] }));
  const pluginAction = jest.fn(async (_ctx: any, _cm: any, _action: string, _dto: any) => ({ ok: true }));
  const registry = {
    get: jest.fn(() => ({
      viewForStudent: studentView,
      viewForTeacher: teacherView,
      action: pluginAction,
      features: { gradable: true, supportsCompletionAuto: true },
    })),
  } as any;

  const markViewed = jest.fn();
  const completion = { markViewed, recomputeAuto: jest.fn() } as any;
  const availability = {
    evaluate: jest.fn(async () => ({ available, reasons: available ? [] : ['Not available until 1 Sept'] })),
  } as any;
  const caps = { canAtCourse: jest.fn(async (_p: any, cap: string) => capabilities.includes(cap)) } as any;
  const events = { log: jest.fn() } as any;

  // The envelope service only decorates the response; these tests are about WHO
  // gets served, so it is stubbed to the minimum the wrapper touches.
  const envelope = {
    courseHeader: jest.fn(async () => ({ id: 'course_1', name: 'Maths — S2', subject: 'Maths', className: 'S2', term: 'T1' })),
    capabilitiesFor: jest.fn(async () => capabilities),
    moduleViews: jest.fn(async () => [{ id: cmRow.id, activityType: cmRow.activityType, name: 'Test quiz' }]),
    progressFor: jest.fn(async () => ({ completed: 0, tracked: 0, percent: 0 })),
  } as any;
  prisma.client.courseOffering = { findFirst: jest.fn(async () => ({ id: 'course_1', showGradesToStudents: true })) };

  const svc = new CourseModuleService(
    prisma, tenant, registry, {} as any, {} as any, completion, availability, events, portalIdentity, caps, envelope,
  );
  return { svc, studentView, teacherView, pluginAction, markViewed, availability, caps };
}

describe('LMS module authorization', () => {
  describe('impersonation', () => {
    it('refuses a student naming another student, rather than ignoring it', async () => {
      const { svc } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' } });
      await expect(svc.view('cm_1', { asStudent: 'sp_bob' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('serves a student their own activity', async () => {
      const { svc, studentView, markViewed } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' } });
      await expect(svc.view('cm_1').then((r) => r.body)).resolves.toEqual({ view: 'student' });
      expect(studentView).toHaveBeenCalled();
      // The subject handed to the plugin is the TOKEN's, not the caller's input.
      expect(studentView.mock.calls[0][0].studentProfileId).toBe('sp_alice');
      expect(markViewed).toHaveBeenCalledWith(expect.anything(), 'sp_alice');
    });

    it('refuses a guardian naming a child who is not theirs', async () => {
      const { svc } = build({
        claim: { kind: 'guardian', guardianContactIds: ['gc_mum'] },
        guardianships: [{ studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' }],
      });
      await expect(svc.view('cm_1', { asStudent: 'sp_bob' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a guardian read their own child, without ticking completion for them', async () => {
      const { svc, studentView, markViewed } = build({
        claim: { kind: 'guardian', guardianContactIds: ['gc_mum'] },
        guardianships: [{ studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' }],
      });
      await expect(svc.view('cm_1', { asStudent: 'sp_alice' }).then((r) => r.body)).resolves.toEqual({ view: 'student' });
      expect(studentView).toHaveBeenCalled();
      // A parent looking in must not complete the activity on the pupil's behalf.
      expect(markViewed).not.toHaveBeenCalled();
    });
  });

  describe('escalation by omission', () => {
    it('does not fall through to the teacher view for a student', async () => {
      const { svc, teacherView, studentView } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' } });
      await svc.view('cm_1');
      expect(teacherView).not.toHaveBeenCalled();
      expect(studentView).toHaveBeenCalled();
    });

    it('refuses staff without the course capability, instead of serving the teacher view', async () => {
      const { svc, teacherView } = build({ capabilities: [] });
      await expect(svc.view('cm_1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(teacherView).not.toHaveBeenCalled();
    });

    it('serves the teacher view to staff who hold the capability', async () => {
      const { svc, teacherView } = build({ capabilities: ['lms/course:manageactivities'] });
      await expect(svc.view('cm_1').then((r) => r.body)).resolves.toEqual({ view: 'teacher', submissions: ['everyone'] });
      expect(teacherView).toHaveBeenCalled();
    });

    it('refuses staff previewing as a student without the preview capability', async () => {
      const { svc } = build({ capabilities: ['lms/course:manageactivities'] });
      await expect(svc.view('cm_1', { asStudent: 'sp_alice' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets staff preview as a student with the preview capability, without ticking completion', async () => {
      const { svc, studentView, markViewed } = build({
        capabilities: ['lms/course:manageactivities', 'lms/course:viewhiddenactivities'],
      });
      await expect(svc.view('cm_1', { asStudent: 'sp_alice' }).then((r) => r.body)).resolves.toEqual({ view: 'student' });
      expect(studentView).toHaveBeenCalled();
      expect(markViewed).not.toHaveBeenCalled();
    });
  });

  describe('availability is enforced on every student path', () => {
    it('blocks a student when the activity is not yet released', async () => {
      const { svc } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' }, available: false });
      await expect(svc.view('cm_1')).rejects.toThrow(/Not available/);
    });

    it('blocks a staff preview too — previewing must not bypass the release rule silently', async () => {
      const { svc } = build({
        capabilities: ['lms/course:manageactivities', 'lms/course:viewhiddenactivities'],
        available: false,
      });
      await expect(svc.view('cm_1', { asStudent: 'sp_alice' })).rejects.toThrow(/Not available/);
    });
  });

  describe('action()', () => {
    it('refuses a student acting as someone else', async () => {
      const { svc, pluginAction } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' } });
      await expect(svc.action('cm_1', 'submit', { asStudent: 'sp_bob' }, { asStudent: 'sp_bob' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(pluginAction).not.toHaveBeenCalled();
    });

    it('runs as the token subject, ignoring a studentProfileId in the body', async () => {
      const { svc, pluginAction } = build({ claim: { kind: 'student', studentProfileId: 'sp_alice' } });
      await svc.action('cm_1', 'submit', { studentProfileId: 'sp_bob', content: 'my work' });
      expect(pluginAction).toHaveBeenCalled();
      expect(pluginAction.mock.calls[0][0].studentProfileId).toBe('sp_alice');
    });

    it('refuses a guardian outright — a parent may read, never submit', async () => {
      const { svc, pluginAction } = build({
        claim: { kind: 'guardian', guardianContactIds: ['gc_mum'] },
        guardianships: [{ studentProfileId: 'sp_alice', guardianContactId: 'gc_mum' }],
      });
      await expect(svc.action('cm_1', 'submit', {}, { asStudent: 'sp_alice' }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(pluginAction).not.toHaveBeenCalled();
    });
  });
});
