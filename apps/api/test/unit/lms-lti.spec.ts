import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import { LtiService } from '../../src/modules/school/lms/moodle/lti/lti.service';

/**
 * L8 — LTI 1.3 platform.
 *
 * Three properties carry the security of the whole handshake, and each is easy
 * to lose in a refactor:
 *
 *  1. A launch session is SINGLE USE. OIDC requires the platform to refuse a
 *     replayed nonce; without it a captured launch URL is reusable.
 *  2. The learner is taken from the stored session, not from anything that comes
 *     back from the tool — the launch is the assertion the tool grades.
 *  3. An AGS score is RESCALED against the activity's own maximum. A tool
 *     reporting 95/100 for work marked out of 20 must land as 19, not 95.
 */
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function build(opts: {
  session?: any;
  instance?: any;
  cm?: any;
  principal?: any;
  studentExists?: boolean;
} = {}) {
  const {
    session = null,
    instance = { id: 'i1', name: 'Tool', toolUrl: 'https://tool.test/launch', clientId: 'cid', deploymentId: 'dep', loginUrl: 'https://tool.test/login', gradable: true, maxScore: 20, customParams: {} },
    cm = { id: 'cm_1', instanceId: 'i1', courseOfferingId: 'c1', activityType: 'lti', assessmentId: 'a1', deletedAt: null },
    principal = { kind: 'student', userId: 'u1', studentProfileId: 'sp_alice' },
    studentExists = true,
  } = opts;

  const setScore = jest.fn();
  const sessionUpdates: any[] = [];
  const created: any[] = [];

  const prisma = {
    client: {
      ltiPlatformKey: {
        findFirst: jest.fn(async () => ({
          kid: 'kid-1', publicKeyPem: publicKey,
          privateKeyCipher: 'c', privateKeyIv: 'i', privateKeyTag: 't',
        })),
        findMany: jest.fn(async () => [{ kid: 'kid-1', publicKeyPem: publicKey }]),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async () => ({})),
      },
      ltiLaunchSession: {
        findFirst: jest.fn(async () => session),
        create: jest.fn(async (a: any) => { created.push(a.data); return a.data; }),
        update: jest.fn(async (a: any) => { sessionUpdates.push(a); return {}; }),
      },
      courseModule: { findFirst: jest.fn(async () => cm) },
      modLti: { findFirst: jest.fn(async () => instance) },
      courseOffering: { findFirst: jest.fn(async () => ({ id: 'c1', subjectId: 's', classId: 'k', termId: 't', academicYearId: 'y' })) },
      studentProfile: { findFirst: jest.fn(async () => (studentExists ? { id: 'sp_alice' } : null)) },
      assessment: { findFirst: jest.fn(async () => ({ id: 'a1', classId: 'k', termId: 't', maxScore: 20 })) },
      studentAssessment: { upsert: jest.fn(async () => ({ id: 'sa1' })) },
      $transaction: jest.fn(async (cb: any) => cb({})),
    },
  } as any;

  const encryption = {
    decrypt: jest.fn(() => privateKey),
    encrypt: jest.fn(() => ({ ciphertext: 'c', iv: 'i', tag: 't' })),
  } as any;
  const portalIdentity = { principal: () => principal } as any;
  const envelope = { courseHeader: jest.fn(async () => ({ name: 'Maths — S2', subject: 'Maths' })) } as any;
  const events = { log: jest.fn() } as any;

  const svc = new LtiService(prisma, { organizationId: 'org_1' } as any, encryption, portalIdentity, envelope, { setScore } as any, events);
  return { svc, setScore, sessionUpdates, created, prisma };
}

const liveSession = (over: any = {}) => ({
  id: 'sess_1', courseModuleId: 'cm_1', state: 'st', nonce: 'nn',
  studentProfileId: 'sp_alice', userId: null,
  consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
  ...over,
});

describe('LTI 1.3 platform', () => {
  describe('launch initiation', () => {
    it('stores the subject from the token, not from the request', async () => {
      const { svc, created } = build();
      const res = await svc.beginLaunch('cm_1');
      expect(res.redirectUrl).toContain('https://tool.test/login');
      expect(created[0].studentProfileId).toBe('sp_alice');
      expect(created[0].userId).toBeNull();
    });

    it('refuses a tool with no OIDC login URL', async () => {
      const { svc } = build({ instance: { id: 'i1', toolUrl: 'https://t', clientId: 'c' } });
      await expect(svc.beginLaunch('cm_1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a tool with no client id', async () => {
      const { svc } = build({ instance: { id: 'i1', toolUrl: 'https://t', loginUrl: 'https://t/login' } });
      await expect(svc.beginLaunch('cm_1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('launch completion', () => {
    it('signs an id_token our published key verifies', async () => {
      const { svc } = build({ session: liveSession() });
      const { idToken, toolUrl } = await svc.completeLaunch('st');
      expect(toolUrl).toBe('https://tool.test/launch');
      const decoded = jwt.verify(idToken, publicKey, { algorithms: ['RS256'] }) as any;
      expect(decoded.sub).toBe('sp_alice');
      expect(decoded.nonce).toBe('nn');
      expect(decoded.aud).toBe('cid');
      expect(decoded['https://purl.imsglobal.org/spec/lti/claim/message_type']).toBe('LtiResourceLinkRequest');
      expect(decoded['https://purl.imsglobal.org/spec/lti/claim/version']).toBe('1.3.0');
    });

    it('consumes the session, so the launch cannot be replayed', async () => {
      const { svc, sessionUpdates } = build({ session: liveSession() });
      await svc.completeLaunch('st');
      expect(sessionUpdates[0].data.consumedAt).toBeInstanceOf(Date);
    });

    it('refuses an already-consumed launch', async () => {
      const { svc } = build({ session: liveSession({ consumedAt: new Date() }) });
      await expect(svc.completeLaunch('st')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an expired launch', async () => {
      const { svc } = build({ session: liveSession({ expiresAt: new Date(Date.now() - 1000) }) });
      await expect(svc.completeLaunch('st')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sends a learner role for a pupil and an instructor role for staff', async () => {
      const learner = build({ session: liveSession() });
      const l = jwt.decode((await learner.svc.completeLaunch('st')).idToken) as any;
      expect(l['https://purl.imsglobal.org/spec/lti/claim/roles'][0]).toMatch(/#Learner$/);

      const staff = build({ session: liveSession({ studentProfileId: null, userId: 'u_teacher' }) });
      const t = jwt.decode((await staff.svc.completeLaunch('st')).idToken) as any;
      expect(t['https://purl.imsglobal.org/spec/lti/claim/roles'][0]).toMatch(/#Instructor$/);
      expect(t.sub).toBe('u_teacher');
    });

    it('advertises the grade endpoint only for a gradable activity', async () => {
      const graded = build({ session: liveSession() });
      const g = jwt.decode((await graded.svc.completeLaunch('st')).idToken) as any;
      expect(g['https://purl.imsglobal.org/spec/lti-ags/claim/endpoint']).toBeDefined();

      // A tool told it may post scores to a non-graded link has nowhere to put them.
      const plain = build({
        session: liveSession(),
        cm: { id: 'cm_1', instanceId: 'i1', courseOfferingId: 'c1', activityType: 'lti', assessmentId: null, deletedAt: null },
      });
      const p = jwt.decode((await plain.svc.completeLaunch('st')).idToken) as any;
      expect(p['https://purl.imsglobal.org/spec/lti-ags/claim/endpoint']).toBeUndefined();
    });
  });

  describe('AGS grade passback', () => {
    it('rescales the tool score against the activity maximum', async () => {
      // 95 out of 100 on a tool, for work marked out of 20 here → 19.
      const { svc, setScore } = build();
      const res = await svc.receiveScore('cm_1', { userId: 'sp_alice', scoreGiven: 95, scoreMaximum: 100 });
      expect(res.score).toBe(19);
      expect(setScore).toHaveBeenCalledWith(expect.objectContaining({ score: 19 }), expect.anything());
    });

    it('defaults a missing tool maximum to 100 rather than dividing by zero', async () => {
      const { svc } = build();
      await expect(svc.receiveScore('cm_1', { userId: 'sp_alice', scoreGiven: 50 })).resolves.toMatchObject({ score: 10 });
    });

    it('ignores a score-less result instead of writing a zero', async () => {
      const { svc, setScore } = build();
      await expect(svc.receiveScore('cm_1', { userId: 'sp_alice' })).resolves.toEqual({ ok: true, score: null });
      expect(setScore).not.toHaveBeenCalled();
    });

    it('refuses a score for a user this platform does not know', async () => {
      const { svc, setScore } = build({ studentExists: false });
      await expect(svc.receiveScore('cm_1', { userId: 'sp_nobody', scoreGiven: 10 }))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(setScore).not.toHaveBeenCalled();
    });

    it('refuses a score for a non-gradable activity', async () => {
      const { svc } = build({
        cm: { id: 'cm_1', instanceId: 'i1', courseOfferingId: 'c1', activityType: 'lti', assessmentId: null, deletedAt: null },
      });
      await expect(svc.receiveScore('cm_1', { userId: 'sp_alice', scoreGiven: 5 }))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('JWKS', () => {
    it('publishes only public material', async () => {
      const { svc } = build();
      const { keys } = await svc.jwks();
      expect(keys[0].kid).toBe('kid-1');
      expect(keys[0].alg).toBe('RS256');
      expect(keys[0].use).toBe('sig');
      // A private exponent in a public keyset would hand over the signing key.
      expect(keys[0].d).toBeUndefined();
      expect(keys[0].p).toBeUndefined();
    });
  });

  describe('activity type', () => {
    it('refuses to launch an activity that is not an external tool', async () => {
      const { svc } = build({
        cm: { id: 'cm_1', instanceId: 'i1', courseOfferingId: 'c1', activityType: 'quiz', deletedAt: null },
      });
      await expect(svc.beginLaunch('cm_1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
