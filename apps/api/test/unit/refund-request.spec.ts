import { ConflictException, ForbiddenException } from '@nestjs/common';
import { RefundRequestService } from '../../src/modules/school/fees/refund-request.service';

/**
 * Refunds are maker-checker (Wave 2.3). The route used to demand BOTH the
 * refund and the approve permission, which no preset holds by design — so only
 * an Administrator could refund, with nobody checking them.
 */
function make(opts: { userId: string; permissions: string[]; request?: any }) {
  const approvalRequest = {
    create: jest.fn(async ({ data }: any) => ({ id: 'req_1', ...data })),
    findFirst: jest.fn(async () => opts.request ?? null),
    findMany: jest.fn(async () => []),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const approvalDecision = { create: jest.fn(async (_args: any) => ({})) };
  const tx = { approvalRequest, approvalDecision };
  const prisma = {
    client: {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      studentProfile: {
        findFirst: jest.fn(async () => ({ id: 'sp_1', admissionNo: 'ADM-1', partner: { name: 'Nakato' } })),
      },
      approvalRequest,
    },
  };
  const tenant = { organizationId: 'org_1', userId: opts.userId, permissions: opts.permissions };
  const audit = { recordInTx: jest.fn() };
  const payments = { refundFee: jest.fn(async () => ({ payment: { id: 'pay_out_1' }, replayed: false })) };
  const svc = new RefundRequestService(prisma as any, tenant as any, audit as any, payments as any);
  return { svc, payments, approvalRequest, approvalDecision };
}

const dto = { studentProfileId: 'sp_1', amount: 200_000, paymentMethod: 'cash' as const };

describe('RefundRequestService', () => {
  it('a Bursar (refund only) files a request; no money moves', async () => {
    const { svc, payments, approvalRequest } = make({ userId: 'bursar', permissions: ['school:fees:refund'] });
    const res = await svc.submit(dto);
    expect(res).toEqual({ status: 'pending_approval', requestId: 'req_1' });
    expect(payments.refundFee).not.toHaveBeenCalled();
    expect(approvalRequest.create.mock.calls[0][0].data).toMatchObject({
      entityType: 'school_fee_refund',
      createdById: 'bursar',
      snapshot: expect.objectContaining({ amount: 200_000, dto: expect.objectContaining(dto) }),
    });
  });

  it('a caller holding refund AND approve (Administrator) refunds in one step', async () => {
    const { svc, payments } = make({
      userId: 'admin',
      permissions: ['school:fees:refund', 'school:fees:refund:approve'],
    });
    const res: any = await svc.submit(dto);
    expect(res.status).toBe('refunded');
    expect(payments.refundFee).toHaveBeenCalledWith(dto);
  });

  const pending = { id: 'req_1', status: 'pending', createdById: 'bursar', snapshot: { dto } };

  it('the requester cannot approve their own refund', async () => {
    const { svc, payments } = make({ userId: 'bursar', permissions: ['school:fees:refund:approve'], request: pending });
    await expect(svc.approve('req_1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.refundFee).not.toHaveBeenCalled();
  });

  it('a second person approving pays out once, keyed to the request', async () => {
    const { svc, payments, approvalRequest, approvalDecision } = make({
      userId: 'head',
      permissions: ['school:fees:refund:approve'],
      request: pending,
    });
    const res: any = await svc.approve('req_1', 'ok');
    expect(res.status).toBe('refunded');
    expect(payments.refundFee).toHaveBeenCalledWith({ ...dto, externalReference: 'refund-request:req_1' });
    expect(approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req_1', status: 'pending' } }),
    );
    expect(approvalDecision.create.mock.calls[0][0].data).toMatchObject({ approverId: 'head', status: 'approved' });
  });

  it('a decided request cannot be approved again', async () => {
    const { svc, payments } = make({
      userId: 'head',
      permissions: ['school:fees:refund:approve'],
      request: { ...pending, status: 'approved' },
    });
    await expect(svc.approve('req_1')).rejects.toBeInstanceOf(ConflictException);
    expect(payments.refundFee).not.toHaveBeenCalled();
  });

  it('rejecting needs a reason and moves no money', async () => {
    const { svc, payments } = make({ userId: 'head', permissions: ['school:fees:refund:approve'], request: pending });
    await expect(svc.reject('req_1', '  ')).rejects.toThrow(/Say why/);
    await expect(svc.reject('req_1', 'Already refunded in cash')).resolves.toMatchObject({ status: 'rejected' });
    expect(payments.refundFee).not.toHaveBeenCalled();
  });
});
