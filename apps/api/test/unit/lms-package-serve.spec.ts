import { ForbiddenException } from '@nestjs/common';
import { PackageServeService } from '../../src/modules/school/lms/moodle/packages/package-serve.service';

/**
 * L8 — package delivery, and the two ways it could go wrong.
 *
 * A SCORM/H5P package is a zip of attacker-supplied files served by URL, so both
 * halves of the request are hostile: the entry path in the URL, and the entry
 * names inside the archive ("zip slip"). A traversal here reads arbitrary files
 * off the server.
 */
function build(opts: { principal?: any; capabilities?: string[] } = {}) {
  const { principal = { kind: 'staff', userId: 'u1' }, capabilities = ['lms/course:view'] } = opts;
  const prisma = {
    client: {
      file: { findFirst: jest.fn(async () => ({ id: 'f1', organizationId: 'org_1', ownerId: 'course_1:scorm_package:cm_1', storageKey: 'pkg.zip', deletedAt: null })) },
      courseEnrolment: { findFirst: jest.fn(async () => null) },
    },
  } as any;
  const portalIdentity = { principal: () => principal, accessibleStudents: jest.fn(async () => []) } as any;
  const caps = { canAtCourse: jest.fn(async (_p: any, c: string) => capabilities.includes(c)) } as any;
  return new PackageServeService(prisma, { organizationId: 'org_1' } as any, {} as any, portalIdentity, caps);
}

/** Reach the private path-sanitiser directly; it is the security boundary. */
const safeEntry = (svc: any, p: string): string => svc.safeEntry(p);

describe('LMS package delivery', () => {
  describe('path traversal (zip slip)', () => {
    const svc: any = build();

    it('refuses a path that climbs out of the archive', () => {
      expect(() => safeEntry(svc, '../../../.env')).toThrow(ForbiddenException);
      expect(() => safeEntry(svc, '..%2f..%2fsecret')).toThrow(ForbiddenException);
    });

    it('treats an absolute path as archive-relative, never as a filesystem path', () => {
      // The result is looked up as a ZIP ENTRY NAME, so `/etc/passwd` becomes
      // `etc/passwd` inside the archive and simply is not found. It never
      // reaches the filesystem, which is what makes this safe rather than a
      // traversal — a browser resolving `/foo` inside the iframe needs this to
      // work, so rejecting it outright would break real packages.
      expect(safeEntry(svc, '/etc/passwd')).toBe('etc/passwd');
      expect(safeEntry(svc, '/index.html')).toBe('index.html');
    });

    it('refuses a null byte', () => {
      expect(() => safeEntry(svc, 'index.html\0.png')).toThrow();
    });

    it('normalises a path that only looks like traversal', () => {
      // `a/b/../c` stays inside the archive and must still work.
      expect(safeEntry(svc, 'assets/js/../css/main.css')).toBe('assets/css/main.css');
    });

    it('strips a leading slash rather than rejecting an ordinary asset', () => {
      expect(safeEntry(svc, 'scormcontent/index.html')).toBe('scormcontent/index.html');
    });

    it('defaults to index.html for an empty path', () => {
      expect(safeEntry(svc, '')).toBe('index.html');
    });
  });

  describe('access control', () => {
    it('refuses a caller with no role on the course', async () => {
      const svc = build({ principal: { kind: 'student', userId: 'u1', studentProfileId: 'sp_1' }, capabilities: [] });
      await expect(svc.read('f1', 'index.html')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a package not attached to any course', async () => {
      const svc: any = build();
      await expect(svc.assertMayRead('')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
