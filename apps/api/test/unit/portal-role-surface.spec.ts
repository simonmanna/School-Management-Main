import { PERMISSIONS, PORTAL_ROLE_PRESETS, PORTAL_ROLE_BY_SUBJECT } from '@erp/shared';

/**
 * What a portal login is allowed to be.
 *
 * The first cut of these presets gave Student and Parent `school:read`, because
 * two self-service routes happened to require it. That one grant is the gate on
 * roughly three hundred routes across the school vertical — `GET school/students`
 * (the whole register), `school/finance/students/:id/balance` (any family's
 * arrears), the gradebook and the marks workspace (unapproved marks) among them.
 * The portal frontend never called any of those, but a guardian holding a valid
 * token and a URL could.
 *
 * A unit test rather than an integration one on purpose: this is a claim about
 * the role DEFINITION, and it should fail the moment someone widens a preset,
 * not only if a request happens to be made in a suite that talks to a database.
 */
describe('portal role presets', () => {
  const byName = (name: string) => {
    const preset = PORTAL_ROLE_PRESETS.find((r) => r.name === name);
    if (!preset) throw new Error(`No portal role preset named ${name}`);
    return preset;
  };

  describe('the family roles', () => {
    it.each(['Student', 'Parent'])('%s does NOT hold school:read', (name) => {
      expect(byName(name).permissions).not.toContain(PERMISSIONS.school.read);
    });

    it.each(['Student', 'Parent'])('%s holds only self-scoped grants', (name) => {
      // Every grant a family role carries must be one whose routes derive their
      // subject from the token. Adding anything else here is the mistake this
      // test exists to catch, so new entries need a deliberate decision.
      const allowed: string[] = [
        PERMISSIONS.school.portalSelf,
        PERMISSIONS.school.parentPortal,
        PERMISSIONS.school.studentPortal,
        PERMISSIONS.school.lmsRead,
        PERMISSIONS.school.submitAssignments,
        // Every CBT route pins a student principal to their own attempt
        // (cbt.controller.ts start/assertOwns), so this is self-scoped too.
        PERMISSIONS.school.takeCbt,
      ];
      for (const grant of byName(name).permissions) {
        expect(allowed).toContain(grant);
      }
    });

    it.each(['Student', 'Parent'])('%s cannot write marks or approve anything', (name) => {
      const perms = byName(name).permissions;
      expect(perms).not.toContain(PERMISSIONS.school.enterGrades);
      expect(perms).not.toContain(PERMISSIONS.school.approveGrades);
      expect(perms).not.toContain(PERMISSIONS.school.publishResults);
      expect(perms).not.toContain(PERMISSIONS.school.takeAttendance);
    });

    it.each(['Student', 'Parent'])('%s cannot mint further portal accounts', (name) => {
      // Being able to USE the portal must never imply being able to create logins
      // that see other families.
      expect(byName(name).permissions).not.toContain(PERMISSIONS.school.managePortalAccounts);
    });

    it('a pupil cannot open the parent workspace, and has no fee grants at all', () => {
      const student = byName('Student').permissions;
      expect(student).not.toContain(PERMISSIONS.school.parentPortal);
      expect(student.filter((p) => p.startsWith('school:fees'))).toEqual([]);
    });

    it('a guardian gets the pupil workspace, scoped elsewhere to their own children', () => {
      // `studentPortal` says WHICH workspace, never WHICH pupil. The second
      // question is answered by @ScopedToStudent against the token's portal
      // claim — see school-portal-onboarding.spec.ts for that half.
      expect(byName('Parent').permissions).toContain(PERMISSIONS.school.studentPortal);
    });
  });

  describe('the teacher role', () => {
    it('may enter marks but never approve its own', () => {
      const perms = byName('Teacher').permissions;
      // Entry is the owner-scoped grant, not the org-wide `school:grades:write`.
      expect(perms).toContain(PERMISSIONS.school.ownGrades);
      // The A0 segregation-of-duty split: whoever enters a mark must not be able
      // to approve it.
      expect(perms).not.toContain(PERMISSIONS.school.approveGrades);
      expect(perms).not.toContain(PERMISSIONS.school.moderateMarks);
      expect(perms).not.toContain(PERMISSIONS.school.publishResults);
      expect(perms).not.toContain(PERMISSIONS.school.amendResults);
    });

    it('writes only through owner-scoped grants', () => {
      const perms = byName('Teacher').permissions;
      expect(perms).toContain(PERMISSIONS.school.ownLessonPlans);
      expect(perms).toContain(PERMISSIONS.school.ownTimetable);
      expect(perms).toContain(PERMISSIONS.school.ownAttendance);
      expect(perms).toContain(PERMISSIONS.school.ownGrades);

      // The org-wide equivalents are the whole point of the split. Holding
      // `school:attendance:write` means marking ANY class in the school;
      // `school:grades:write` means marking ANY paper. Both are right for the
      // office and wrong for a portal session, and the handlers let them through
      // unchallenged — so a teacher must not carry them.
      expect(perms).not.toContain(PERMISSIONS.school.takeAttendance);
      expect(perms).not.toContain(PERMISSIONS.school.enterGrades);
      expect(perms).not.toContain(PERMISSIONS.school.manageLessonPlans);
      expect(perms).not.toContain(PERMISSIONS.school.manageFoundation);
    });

    it('reads its own HR record, not the whole payroll', () => {
      const perms = byName('Teacher').permissions;
      expect(perms).toContain(PERMISSIONS.hr.self);
      expect(perms).not.toContain(PERMISSIONS.hr.read);
      expect(perms).not.toContain(PERMISSIONS.hr.payroll);
    });

    it('holds school:read deliberately, and nothing that manages the school', () => {
      // Documented widening: a teacher needs registers, class lists, timetables
      // and the subject tree, and those reads are spread across the vertical
      // rather than mirrored behind self-scoped routes. It is why a Teacher role
      // is granted by an administrator and never minted by an invite.
      const perms = byName('Teacher').permissions;
      expect(perms).toContain(PERMISSIONS.school.read);
      expect(perms).not.toContain(PERMISSIONS.school.manageStudents);
      expect(perms).not.toContain(PERMISSIONS.school.manageStaff);
      expect(perms).not.toContain(PERMISSIONS.school.managePortalAccounts);
    });
  });

  describe('what an invite may mint', () => {
    it('maps a subject type to a family role and never to Teacher', () => {
      expect(PORTAL_ROLE_BY_SUBJECT.student).toBe('Student');
      expect(PORTAL_ROLE_BY_SUBJECT.guardian).toBe('Parent');
      expect(Object.values(PORTAL_ROLE_BY_SUBJECT)).not.toContain('Teacher');
    });

    it('names a preset that actually exists', () => {
      for (const roleName of Object.values(PORTAL_ROLE_BY_SUBJECT)) {
        expect(PORTAL_ROLE_PRESETS.map((r) => r.name)).toContain(roleName);
      }
    });
  });

  it('grants only permissions the catalog defines', () => {
    // A typo in a preset would otherwise produce a role holding a string no guard
    // will ever require — a login that silently cannot do the thing it was made
    // for, with nothing to indicate why.
    const { ALL_PERMISSIONS } = jest.requireActual('@erp/shared') as { ALL_PERMISSIONS: string[] };
    for (const preset of PORTAL_ROLE_PRESETS) {
      for (const grant of preset.permissions) {
        expect(ALL_PERMISSIONS).toContain(grant);
      }
    }
  });
});
