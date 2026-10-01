/**
 * Admissions review 2026-09-30:
 *  - P1-2: a closed (enrolled / rejected / withdrawn / declined) application is
 *    read-only, so it cannot drift away from the pupil created from it.
 *  - P1-3: the field write and the guardian replacement share one transaction.
 *  - P2-4: the worklist filters by status server-side and never ships NIN columns.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';

function build(current: Record<string, unknown> | null) {
  const tx = {
    admissionApplication: {
      findFirst: jest.fn(async () => current),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    admissionCycle: { findFirst: jest.fn() },
    admissionGuardian: { deleteMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async () => ({})) },
  };
  const client = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    admissionApplication: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => ({ id: 'a1' })),
    },
    offerLetter: { findMany: jest.fn(async () => []) },
    admissionDecision: { findMany: jest.fn(async () => []) },
  };
  const audit = { recordInTx: jest.fn(async () => undefined) };
  const encryption = { encrypt: jest.fn(() => ({ ciphertext: 'c', iv: 'i', tag: 't' })) };
  const svc = new AdmissionsService(
    { client } as any,
    { organizationId: 'org1', userId: 'u1' } as any,
    audit as any,
    {} as any, {} as any, {} as any, {} as any,
    encryption as any,
    {} as any, {} as any, {} as any,
  );
  jest.spyOn(svc, 'findOne').mockResolvedValue({ id: 'a1' } as any);
  return { svc, tx, client, audit };
}

describe('AdmissionsService.update — closed applications are read-only', () => {
  it.each(['enrolled', 'rejected', 'withdrawn', 'offer_declined'])('refuses to edit a %s application', async (status) => {
    const { svc, tx } = build({ id: 'a1', status, applicationNumber: 'APP-1', organizationId: 'org1' });
    await expect(svc.update('a1', { applicantFirstName: 'X' } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.admissionApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.admissionGuardian.deleteMany).not.toHaveBeenCalled();
  });

  it('404s an unknown application', async () => {
    const { svc } = build(null);
    await expect(svc.update('nope', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes fields and replaces guardians inside one transaction, guarded on status, and audits', async () => {
    const { svc, tx, client, audit } = build({ id: 'a1', status: 'under_review', applicationNumber: 'APP-1', organizationId: 'org1' });
    await svc.update('a1', {
      applicantFirstName: 'Amina',
      nin: 'CM123',
      guardians: [{ firstName: 'Grace', relationship: 'mother', phone: '0700' }],
    } as any);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.admissionApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'under_review' },
      data: expect.objectContaining({ applicantFirstName: 'Amina', ninCiphertext: 'c' }),
    });
    expect(tx.admissionGuardian.deleteMany).toHaveBeenCalledWith({ where: { applicationId: 'a1', contactId: null } });
    expect(tx.admissionGuardian.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ applicationId: 'a1', organizationId: 'org1', firstName: 'Grace', relationship: 'mother' }),
    });
    const audited = (audit.recordInTx.mock.calls[0] as any[])[1];
    expect(audited.newValues).toEqual(expect.objectContaining({ nin: '[changed]', guardians: 1 }));
    expect(JSON.stringify(audited)).not.toContain('CM123');
  });

  it('a failed guardian insert propagates out of the transaction', async () => {
    const { svc, tx } = build({ id: 'a1', status: 'submitted', applicationNumber: 'APP-1', organizationId: 'org1' });
    tx.admissionGuardian.create.mockRejectedValueOnce(new Error('boom'));
    await expect(
      svc.update('a1', { guardians: [{ firstName: 'G', relationship: 'father' }] } as any),
    ).rejects.toThrow('boom');
  });

  it('409s when the status changed between read and write (concurrent enroll)', async () => {
    const { svc, tx } = build({ id: 'a1', status: 'offer_accepted', applicationNumber: 'APP-1', organizationId: 'org1' });
    tx.admissionApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.update('a1', { applicantFirstName: 'X' } as any)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AdmissionsService.listWithWorkflow — server-side worklist', () => {
  it('filters by status and search, pages, and omits NIN columns', async () => {
    const { svc, client } = build(null);
    const res = await svc.listWithWorkflow({ page: 3, pageSize: 20, status: 'accepted', search: 'ami' });
    const args = (client.admissionApplication.findMany.mock.calls[0] as any[])[0];
    expect(args.where.status).toBe('accepted');
    expect(args.where.OR).toEqual(expect.arrayContaining([{ applicantFirstName: { contains: 'ami', mode: 'insensitive' } }]));
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
    expect(args.omit).toEqual({ ninCiphertext: true, ninIv: true, ninTag: true });
    expect(args.include).toBeUndefined();
    expect(res.meta).toEqual({ page: 3, pageSize: 20, total: 0, totalPages: 1 });
  });
});
