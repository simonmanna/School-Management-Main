import { ForbiddenException } from '@nestjs/common';
import { LmsFileService } from '../../src/modules/school/lms/moodle/files/lms-file.service';

/**
 * L2.1 — LMS file access control.
 *
 * The kernel's `signDownloadForCaller` checks only the tenant, so any
 * authenticated user in the organization could mint a working download link for
 * any file id. Everything here exists to add the missing question — may THIS
 * caller read a file on THIS course, in THIS area?
 *
 * The `submission` area is the sharpest case: those files are one pupil's work.
 */
function build(opts: {
  principal: any;
  capabilities?: string[];
  file?: any;
  submissionOwner?: string | null;
  guardianChildOnCourse?: boolean;
}) {
  const {
    principal, capabilities = [], submissionOwner = null, guardianChildOnCourse = false,
    file = {
      id: 'f1', organizationId: 'org_1', ownerType: 'lms',
      ownerId: 'course_1:submission:sub_1', filename: 'essay.pdf',
      contentType: 'application/pdf', byteSize: 1024, createdAt: new Date(), deletedAt: null,
    },
  } = opts;

  const prisma = {
    client: {
      file: { findFirst: jest.fn(async () => file), findMany: jest.fn(async () => []), update: jest.fn(async () => file) },
      modAssignSubmission: { findFirst: jest.fn(async () => (submissionOwner ? { studentProfileId: submissionOwner } : null)) },
      courseEnrolment: { findFirst: jest.fn(async () => (guardianChildOnCourse ? { id: 'e1' } : null)) },
    },
  } as any;

  const files = { signDownloadForCaller: jest.fn(async () => ({ url: '/signed', expiresAt: 'later' })), remove: jest.fn() } as any;
  const portalIdentity = {
    principal: () => principal,
    canAccessStudent: jest.fn(async (id: string) =>
      principal.kind === 'staff' ||
      (principal.kind === 'student' && principal.studentProfileId === id) ||
      (principal.kind === 'guardian' && (principal.children ?? []).includes(id))),
    accessibleStudents: jest.fn(async () => principal.children ?? []),
  } as any;
  const caps = { canAtCourse: jest.fn(async (_p: any, cap: string) => capabilities.includes(cap)) } as any;
  const events = { log: jest.fn() } as any;

  return {
    svc: new LmsFileService(prisma, { organizationId: 'org_1' } as any, files, portalIdentity, caps, events),
    files,
  };
}

const STUDENT = (id: string) => ({ kind: 'student', userId: 'u1', studentProfileId: id });
const STAFF = { kind: 'staff', userId: 'u_teacher' };
const GUARDIAN = (children: string[]) => ({ kind: 'guardian', userId: 'u_mum', guardianContactIds: ['gc'], children });

describe('LMS file access control', () => {
  describe('submission area — one pupil\'s work', () => {
    it('lets the owning pupil download their own submission', async () => {
      const { svc, files } = build({ principal: STUDENT('sp_alice'), submissionOwner: 'sp_alice' });
      await expect(svc.signDownload('f1')).resolves.toMatchObject({ url: '/signed' });
      expect(files.signDownloadForCaller).toHaveBeenCalledWith('f1');
    });

    it('refuses a classmate', async () => {
      const { svc, files } = build({ principal: STUDENT('sp_bob'), submissionOwner: 'sp_alice' });
      await expect(svc.signDownload('f1')).rejects.toBeInstanceOf(ForbiddenException);
      // The kernel signer must never be reached on a refusal.
      expect(files.signDownloadForCaller).not.toHaveBeenCalled();
    });

    it('refuses staff who cannot mark this course', async () => {
      const { svc } = build({ principal: STAFF, submissionOwner: 'sp_alice', capabilities: [] });
      await expect(svc.signDownload('f1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a marker read it', async () => {
      const { svc } = build({
        principal: STAFF, submissionOwner: 'sp_alice',
        capabilities: ['mod/assign:viewsubmissions'],
      });
      await expect(svc.signDownload('f1')).resolves.toMatchObject({ url: '/signed' });
    });

    it('lets a guardian read their own child\'s work', async () => {
      const { svc } = build({ principal: GUARDIAN(['sp_alice']), submissionOwner: 'sp_alice' });
      await expect(svc.signDownload('f1')).resolves.toMatchObject({ url: '/signed' });
    });

    it('refuses a guardian another family\'s work', async () => {
      const { svc } = build({ principal: GUARDIAN(['sp_ben']), submissionOwner: 'sp_alice' });
      await expect(svc.signDownload('f1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when the owner cannot be resolved, rather than defaulting to allow', async () => {
      // A private file with no resolvable subject is a bug; guessing "allow"
      // would leak someone's work.
      const { svc } = build({ principal: STUDENT('sp_alice'), submissionOwner: null });
      await expect(svc.signDownload('f1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('course content areas', () => {
    const contentFile = {
      id: 'f2', organizationId: 'org_1', ownerType: 'lms', ownerId: 'course_1:resource:cm_1',
      filename: 'notes.pdf', contentType: 'application/pdf', byteSize: 10, createdAt: new Date(), deletedAt: null,
    };

    it('lets any course participant download', async () => {
      const { svc } = build({
        principal: STUDENT('sp_alice'), file: contentFile, capabilities: ['lms/course:view'],
      });
      await expect(svc.signDownload('f2')).resolves.toMatchObject({ url: '/signed' });
    });

    it('refuses someone with no role on the course', async () => {
      const { svc } = build({ principal: STUDENT('sp_alice'), file: contentFile, capabilities: [] });
      await expect(svc.signDownload('f2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a guardian read course content when a child is enrolled', async () => {
      // A guardian holds no course capability — they are not enrolled — so this
      // path exists specifically for them.
      const { svc } = build({
        principal: GUARDIAN(['sp_alice']), file: contentFile, capabilities: [], guardianChildOnCourse: true,
      });
      await expect(svc.signDownload('f2')).resolves.toMatchObject({ url: '/signed' });
    });

    it('refuses a guardian with no child on the course', async () => {
      const { svc } = build({
        principal: GUARDIAN(['sp_ben']), file: contentFile, capabilities: [], guardianChildOnCourse: false,
      });
      await expect(svc.signDownload('f2')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('non-LMS files', () => {
    it('refuses to sign a file that does not belong to a course', async () => {
      // Otherwise this endpoint becomes a bypass around the kernel's own checks
      // for, say, applicant documents.
      const { svc } = build({
        principal: STAFF,
        file: { id: 'f3', organizationId: 'org_1', ownerType: 'Partner', ownerId: 'p1', deletedAt: null },
      });
      await expect(svc.signDownload('f3')).rejects.toThrow(/Not an LMS file/);
    });
  });

  describe('attach', () => {
    it('refuses a pupil attaching to someone else\'s submission', async () => {
      const { svc } = build({ principal: STUDENT('sp_bob'), capabilities: ['mod/assign:submit'] });
      await expect(
        svc.attach({ fileId: 'f1', courseOfferingId: 'course_1', area: 'submission', itemId: 'sub_1', studentProfileId: 'sp_alice' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a guardian attaching work at all', async () => {
      const { svc } = build({ principal: GUARDIAN(['sp_alice']) });
      await expect(
        svc.attach({ fileId: 'f1', courseOfferingId: 'course_1', area: 'submission', itemId: 'sub_1', studentProfileId: 'sp_alice' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a pupil attach to their own submission', async () => {
      const { svc } = build({ principal: STUDENT('sp_alice'), capabilities: ['mod/assign:submit'] });
      await expect(
        svc.attach({ fileId: 'f1', courseOfferingId: 'course_1', area: 'submission', itemId: 'sub_1', studentProfileId: 'sp_alice' }),
      ).resolves.toMatchObject({ filename: 'essay.pdf' });
    });

    it('refuses a pupil adding course content', async () => {
      const { svc } = build({ principal: STUDENT('sp_alice'), capabilities: ['lms/course:view'] });
      await expect(
        svc.attach({ fileId: 'f1', courseOfferingId: 'course_1', area: 'resource', itemId: 'cm_1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a teacher add course content', async () => {
      const { svc } = build({ principal: STAFF, capabilities: ['lms/course:manageactivities'] });
      await expect(
        svc.attach({ fileId: 'f1', courseOfferingId: 'course_1', area: 'resource', itemId: 'cm_1' }),
      ).resolves.toMatchObject({ filename: 'essay.pdf' });
    });
  });
});
