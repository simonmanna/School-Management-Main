import { LmsNotifyService } from '../../src/modules/school/lms/moodle/notify/lms-notify.service';

/**
 * Guardian reach on LMS notifications.
 *
 * In a nursery or primary school the person who must act on "homework due
 * tomorrow" is at home, so guardians receive the pupil's notices too. Two rules
 * govern that, and this suite exists to hold them:
 *
 *  1. **The release gate applies to a guardian exactly as to a pupil.** A
 *     notification must never become a side channel around the moderation gate
 *     that `view-envelope`, `gradebook.userReport` and `LearnerService` enforce.
 *     An unapproved mark reaches nobody.
 *  2. **Guardianship is resolved live.** Revoking a guardianship stops the
 *     notices at once, not at token expiry — which means reading
 *     `StudentGuardian` and `PortalIdentity` per send, never a cached list.
 */

const ORG = 'org_1';

function build(opts: {
  guardianLinks?: any[];
  identities?: any[];
  assessment?: any;
  mark?: any;
} = {}) {
  const {
    guardianLinks = [{ guardianContactId: 'contact_mum' }],
    identities = [
      { userId: 'user_pupil', subjectType: 'student', studentProfileId: 'stu_1', revokedAt: null },
      { userId: 'user_mum', subjectType: 'guardian', guardianContactId: 'contact_mum', revokedAt: null },
    ],
    assessment = {
      title: 'Fractions worksheet',
      maxScore: 20,
      hiddenFromStudents: false,
      marksReleaseAt: new Date('2026-01-01'),
    },
    mark = { effectiveScore: 18, approvalStatus: 'approved' },
  } = opts;

  const sends: any[] = [];

  const portalIdentity = {
    findFirst: jest.fn(async (a: any) => {
      const w = a.where ?? {};
      return (
        identities.find(
          (i) =>
            i.subjectType === w.subjectType &&
            (w.studentProfileId === undefined || i.studentProfileId === w.studentProfileId) &&
            i.revokedAt === null,
        ) ?? null
      );
    }),
    findMany: jest.fn(async (a: any) => {
      const w = a.where ?? {};
      const wanted: string[] = w.guardianContactId?.in ?? [];
      return identities.filter(
        (i) => i.subjectType === 'guardian' && i.revokedAt === null && wanted.includes(i.guardianContactId),
      );
    }),
  };

  const raw: Record<string, any> = {
    portalIdentity,
    studentGuardian: { findMany: jest.fn(async () => guardianLinks) },
    courseModule: { findMany: jest.fn(async () => []) },
    courseEnrolment: { findMany: jest.fn(async () => []) },
    courseModuleCompletion: { findMany: jest.fn(async () => []) },
    modAssignSubmission: { findMany: jest.fn(async () => []) },
    lmsEvent: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
  };

  const client: Record<string, any> = {
    courseModule: {
      findFirst: jest.fn(async () => ({ assessmentId: 'a_1', courseOfferingId: 'co_1' })),
    },
    assessment: { findFirst: jest.fn(async () => assessment) },
    studentAssessment: { findFirst: jest.fn(async () => mark) },
    courseEnrolment: { findMany: jest.fn(async () => []) },
  };

  const prisma = { raw, client } as any;
  const notifications = {
    send: jest.fn(async (input: any) => {
      sends.push(input);
      return {};
    }),
  } as any;

  const svc = new LmsNotifyService(prisma, { organizationId: ORG } as any, notifications);
  return { svc, sends, raw, notifications };
}

describe('graded notice — the release gate reaches guardians too', () => {
  it('sends the score to the pupil and the guardian once it is released', async () => {
    const { svc, sends } = build();
    await svc.notifyGraded('stu_1', 'cm_1');

    const to = sends.map((x) => x.userId);
    expect(to).toContain('user_pupil');
    expect(to).toContain('user_mum');
    for (const s of sends) expect(s.body).toContain('18 out of 20');
  });

  it('withholds the score from BOTH while moderation has not approved it', async () => {
    const { svc, sends } = build({ mark: { effectiveScore: 18, approvalStatus: 'submitted' } });
    await svc.notifyGraded('stu_1', 'cm_1');

    expect(sends).toHaveLength(2);
    for (const s of sends) {
      expect(s.body).not.toContain('18');
      // Pupil: "once it is released". Guardian: "once the school releases it".
      expect(s.body).toMatch(/release/i);
    }
  });

  it('withholds the score when the release date has not arrived', async () => {
    const { svc, sends } = build({
      assessment: {
        title: 'Fractions worksheet',
        maxScore: 20,
        hiddenFromStudents: false,
        marksReleaseAt: new Date(Date.now() + 86_400_000),
      },
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    for (const s of sends) expect(s.body).not.toContain('18');
  });

  it('withholds the score when no release date is set at all', async () => {
    const { svc, sends } = build({
      assessment: { title: 'X', maxScore: 20, hiddenFromStudents: false, marksReleaseAt: null },
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    for (const s of sends) expect(s.body).not.toContain('18');
  });

  it('tells nobody about an assessment hidden from students', async () => {
    const { svc, sends } = build({
      assessment: { title: 'X', maxScore: 20, hiddenFromStudents: true, marksReleaseAt: new Date('2026-01-01') },
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends).toEqual([]);
  });

  it('still reaches the guardian when the pupil has no login yet', async () => {
    const { svc, sends } = build({
      identities: [{ userId: 'user_mum', subjectType: 'guardian', guardianContactId: 'contact_mum', revokedAt: null }],
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends.map((s) => s.userId)).toEqual(['user_mum']);
  });

  it('names the child in the guardian payload, so a two-child family can tell', async () => {
    const { svc, sends } = build();
    await svc.notifyGraded('stu_1', 'cm_1');
    const guardianSend = sends.find((s) => s.userId === 'user_mum');
    expect(guardianSend.payload.studentProfileId).toBe('stu_1');
  });
});

describe('guardianship is resolved live', () => {
  it('sends nothing to a revoked guardian', async () => {
    const { svc, sends } = build({
      identities: [
        { userId: 'user_pupil', subjectType: 'student', studentProfileId: 'stu_1', revokedAt: null },
        { userId: 'user_mum', subjectType: 'guardian', guardianContactId: 'contact_mum', revokedAt: new Date() },
      ],
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends.map((s) => s.userId)).toEqual(['user_pupil']);
  });

  it('sends nothing extra when the pupil has no guardian linked', async () => {
    const { svc, sends } = build({ guardianLinks: [] });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends.map((s) => s.userId)).toEqual(['user_pupil']);
  });

  it('reads StudentGuardian on every send rather than trusting a cached list', async () => {
    const { svc, raw } = build();
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(raw.studentGuardian.findMany).toHaveBeenCalled();
  });

  it('does not tell one guardian twice', async () => {
    const { svc, sends } = build({
      // The same contact linked twice — a data state that exists in the wild.
      guardianLinks: [{ guardianContactId: 'contact_mum' }, { guardianContactId: 'contact_mum' }],
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends.filter((s) => s.userId === 'user_mum')).toHaveLength(1);
  });

  it('reaches every guardian of the child', async () => {
    const { svc, sends } = build({
      guardianLinks: [{ guardianContactId: 'contact_mum' }, { guardianContactId: 'contact_dad' }],
      identities: [
        { userId: 'user_pupil', subjectType: 'student', studentProfileId: 'stu_1', revokedAt: null },
        { userId: 'user_mum', subjectType: 'guardian', guardianContactId: 'contact_mum', revokedAt: null },
        { userId: 'user_dad', subjectType: 'guardian', guardianContactId: 'contact_dad', revokedAt: null },
      ],
    });
    await svc.notifyGraded('stu_1', 'cm_1');
    expect(sends.map((s) => s.userId).sort()).toEqual(['user_dad', 'user_mum', 'user_pupil']);
  });
});

describe('channel', () => {
  it('stays in-app: escalating to SMS would need the consent ledger', async () => {
    const { svc, sends } = build();
    await svc.notifyGraded('stu_1', 'cm_1');
    for (const s of sends) expect(s.channel).toBe('in_app');
  });
});
