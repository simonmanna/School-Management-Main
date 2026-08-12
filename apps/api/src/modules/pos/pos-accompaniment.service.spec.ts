/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosAccompanimentService } from './pos-accompaniment.service';

describe('PosAccompanimentService', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let audit: any;
  let svc: PosAccompanimentService;

  beforeEach(() => {
    const tx = { accompanimentGroup: { create: jest.fn(), update: jest.fn() }, accompanimentOption: { update: jest.fn(), create: jest.fn() }, auditLog: { create: jest.fn() } };
    prisma = { client: { $transaction: jest.fn((cb: any) => cb(tx)), accompanimentGroup: { findFirst: jest.fn() }, accompanimentOption: { findFirst: jest.fn() }, menuItemAccompanimentGroup: { findMany: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() }, menuItem: { findFirst: jest.fn() } } } as any;
    tenant = { organizationId: orgId, userId: 'test-user', optionalOrganizationId: orgId };
    audit = { recordInTx: jest.fn(), record: jest.fn() };
    svc = new PosAccompanimentService(prisma as any, tenant as any, audit as any);
  });

  describe('createGroup', () => {
    it('throws on empty name', async () => {
      await expect(svc.createGroup({ name: '' })).rejects.toThrow('Accompaniment group name is required');
    });

    it('throws on minSelect > maxSelect', async () => {
      await expect(svc.createGroup({ name: 'Sides', minSelect: 3, maxSelect: 1 })).rejects.toThrow('minSelect cannot be greater than maxSelect');
    });

    it('throws on duplicate name', async () => {
      prisma.client.accompanimentGroup.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(svc.createGroup({ name: 'Sides' })).rejects.toThrow('already exists');
    });
  });

  describe('updateGroup', () => {
    const existing = { id: 'g1', organizationId: orgId, name: 'Sides', isRequired: true, minSelect: 1, maxSelect: 1, sortOrder: 0, isActive: true, deletedAt: null, updatedAt: new Date() };

    it('throws on empty name', async () => {
      prisma.client.accompanimentGroup.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateGroup('g1', { name: '' })).rejects.toThrow('Group name cannot be empty');
    });

    it('throws on minSelect > maxSelect', async () => {
      prisma.client.accompanimentGroup.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateGroup('g1', { minSelect: 5, maxSelect: 2 })).rejects.toThrow('minSelect cannot be greater than maxSelect');
    });

    it('throws 409 on concurrency conflict', async () => {
      const staleExisting = { ...existing, updatedAt: new Date(0) };
      prisma.client.accompanimentGroup.findFirst.mockResolvedValueOnce(staleExisting);
      await expect(svc.updateGroup('g1', { name: 'New', expectedUpdatedAt: new Date(Date.now() + 10000).toISOString() })).rejects.toThrow('was modified by another user');
    });

    it('succeeds on valid update', async () => {
      const updated = { ...existing, name: 'New Sides' };
      prisma.client.accompanimentGroup.findFirst.mockResolvedValue(existing);
      const tx = { accompanimentGroup: { update: jest.fn().mockResolvedValue(updated) }, auditLog: { create: jest.fn() } };
      prisma.client.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      prisma.client.accompanimentGroup.findFirst.mockResolvedValue(updated);
      (svc as any).getGroup = jest.fn().mockResolvedValue(updated);
      const result = await svc.updateGroup('g1', { name: 'New Sides' });
      expect(result.name).toBe('New Sides');
      expect(audit.recordInTx).toHaveBeenCalled();
    });
  });

  describe('createOption', () => {
    it('throws on empty name', async () => {
      await expect(svc.createOption('g1', { name: '' })).rejects.toThrow('Option name is required');
    });

    it('throws on duplicate name in group', async () => {
      prisma.client.accompanimentGroup.findFirst.mockResolvedValueOnce({ id: 'g1', organizationId: orgId });
      prisma.client.accompanimentOption.findFirst.mockResolvedValueOnce({ id: 'o1' });
      await expect(svc.createOption('g1', { name: 'Rice' })).rejects.toThrow('already exists');
    });
  });

  describe('updateOption', () => {
    const existing = { id: 'o1', organizationId: orgId, name: 'Rice', priceImpact: 0, isDefault: false, sortOrder: 0, isActive: true, inventoryItemId: null, deletedAt: null, updatedAt: new Date() };

    it('throws on empty name', async () => {
      prisma.client.accompanimentOption.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateOption('o1', { name: '' })).rejects.toThrow('Option name cannot be empty');
    });

    it('throws 409 on concurrency conflict', async () => {
      const stale = { ...existing, updatedAt: new Date(0) };
      prisma.client.accompanimentOption.findFirst.mockResolvedValueOnce(stale);
      await expect(svc.updateOption('o1', { name: 'New', expectedUpdatedAt: new Date(Date.now() + 10000).toISOString() })).rejects.toThrow('was modified by another user');
    });
  });
});
