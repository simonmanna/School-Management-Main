import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, SCHOOL_ROLE_PRESETS } from '@erp/shared';
import { FilesService } from '../../src/kernel/files/files.service';
import { PERMISSIONS_KEY } from '../../src/kernel/auth/decorators/require-permissions.decorator';
import { SchoolDocumentsController } from '../../src/modules/school/documents/school-documents.controller';

/**
 * Documents (E2E audit D1/D2):
 *   D1  a document link is a SIGNED url: sign → resolve round-trips, and a
 *       tampered or unsigned link is refused.
 *   D2  the register is gated on the documents grants, not `school:read`.
 *   and deleting a file refuses while it is attached, applies the sensitivity
 *   rule, soft-deletes and audits (it used to unlink the bytes first).
 */
function make(file: any, perms: string[] = ['school:documents:read', 'school:documents:write']) {
  const fileApi = {
    findFirst: jest.fn(async () => file),
    update: jest.fn(async () => ({})),
  };
  const prisma = { client: { file: fileApi }, raw: { file: fileApi } };
  const tenant = { organizationId: 'org_1', userId: 'u_staff', permissions: perms, optionalOrganizationId: 'org_1' };
  const audit = { record: jest.fn(async () => undefined) };
  const svc = new FilesService(prisma as any, tenant as any, audit as any);
  return { svc, fileApi, audit };
}

const baseFile = {
  id: 'f_1',
  organizationId: 'org_1',
  filename: 'birth-cert.pdf',
  ownerType: 'school_doc',
  uploadedById: 'someone_else',
  visibility: 'private',
  deletedAt: null,
  studentDocuments: [],
  applicationDocuments: [],
  schoolDocs: [{ category: 'identity', type: 'birth_certificate' }],
};

describe('document downloads are signed (D1)', () => {
  it('signs a url that resolves back to the same file, and refuses a tampered one', async () => {
    const { svc } = make(baseFile);
    const { url } = await svc.signDownloadForCaller('f_1');
    const q = new URL(`http://x${url}`).searchParams;
    await expect(svc.resolveSignedDownload('f_1', q.get('token')!, q.get('expires')!, q.get('org')!)).resolves.toMatchObject({
      id: 'f_1',
    });
    await expect(svc.resolveSignedDownload('f_1', 'forged', q.get('expires')!, q.get('org')!)).rejects.toThrow(/Invalid signed URL/);
    await expect(svc.resolveSignedDownload('f_1', undefined as any, undefined as any, undefined as any)).rejects.toThrow();
  });

  it('a health record in the documents register needs the medical grant to open', async () => {
    const { svc } = make({ ...baseFile, schoolDocs: [{ category: 'medical', type: 'immunisation card' }] });
    await expect(svc.signDownloadForCaller('f_1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('deleting a stored file', () => {
  const counts = { schoolDocs: 0, schoolDocSignatures: 0, studentDocuments: 0, applicationDocuments: 0, documentAttachments: 0, hrEmployeeDocuments: 0 };

  it('refuses while a document still uses it', async () => {
    const { svc, fileApi } = make({ ...baseFile, _count: { ...counts, schoolDocs: 1 } });
    await expect(svc.remove('f_1')).rejects.toBeInstanceOf(ConflictException);
    expect(fileApi.update).not.toHaveBeenCalled();
  });

  it('soft-deletes and audits an unattached file', async () => {
    const { svc, fileApi, audit } = make({ ...baseFile, _count: counts });
    await svc.remove('f_1');
    expect(fileApi.update).toHaveBeenCalledWith({ where: { id: 'f_1' }, data: { deletedAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entity: 'File', action: 'delete' }));
  });

  it("does not reveal another tenant's file", async () => {
    const { svc } = make({ ...baseFile, organizationId: 'org_2', _count: counts });
    await expect(svc.remove('f_1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('the documents register is gated on the documents grants (D2)', () => {
  const required = (handler: keyof SchoolDocumentsController) =>
    Reflect.getMetadata(PERMISSIONS_KEY, SchoolDocumentsController.prototype[handler]) as string[];

  it.each(['list', 'get', 'versions'] as const)('%s needs school:documents:read, not school:read', (h) => {
    expect(required(h)).toEqual([PERMISSIONS.school.readDocuments]);
  });

  it('the Head Teacher preset lists documents; the Bursar (no documents grant) cannot', () => {
    const holds = (name: string) =>
      SCHOOL_ROLE_PRESETS.find((p) => p.name === name)?.permissions.includes(PERMISSIONS.school.readDocuments);
    expect(holds('Head Teacher')).toBe(true);
    expect(holds('Bursar')).toBe(false);
  });
});
