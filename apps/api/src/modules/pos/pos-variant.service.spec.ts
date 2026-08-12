/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosVariantService } from './pos-variant.service';

describe('PosVariantService', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let audit: any;
  let svc: PosVariantService;

  beforeEach(() => {
    const tx = { menuItemVariant: { update: jest.fn(), create: jest.fn() }, auditLog: { create: jest.fn() } };
    prisma = { client: { $transaction: jest.fn((cb: any) => cb(tx)), menuItemVariant: { findFirst: jest.fn(), findMany: jest.fn() }, menuItem: { findFirst: jest.fn() } } } as any;
    tenant = { organizationId: orgId, userId: 'test-user', optionalOrganizationId: orgId };
    audit = { recordInTx: jest.fn(), record: jest.fn() };
    svc = new PosVariantService(prisma as any, tenant as any, audit as any);
  });

  describe('createVariant', () => {
    it('throws on empty name', async () => {
      prisma.client.menuItem.findFirst.mockResolvedValueOnce({ id: 'mi1' });
      await expect(svc.createVariant('mi1', { name: '', price: 10 })).rejects.toThrow('Variant name is required');
    });

    it('throws on negative price', async () => {
      await expect(svc.createVariant('mi1', { name: 'Large', price: -1 })).rejects.toThrow('Variant price must be >= 0');
    });

    it('throws on duplicate name', async () => {
      prisma.client.menuItem.findFirst.mockResolvedValueOnce({ id: 'mi1' });
      prisma.client.menuItemVariant.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(svc.createVariant('mi1', { name: 'Large', price: 15 })).rejects.toThrow('already exists');
    });
  });

  describe('updateVariant', () => {
    const existing = { id: 'v1', organizationId: orgId, menuItemId: 'mi1', name: 'Large', price: 15, sortOrder: 1, isActive: true, deletedAt: null, updatedAt: new Date() };

    it('throws on empty name', async () => {
      prisma.client.menuItemVariant.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateVariant('v1', { name: '' })).rejects.toThrow('Variant name cannot be empty');
    });

    it('throws on negative price', async () => {
      prisma.client.menuItemVariant.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateVariant('v1', { price: -5 })).rejects.toThrow('Variant price must be >= 0');
    });

    it('throws 409 on concurrency conflict', async () => {
      const stale = { ...existing, updatedAt: new Date(0) };
      prisma.client.menuItemVariant.findFirst.mockResolvedValueOnce(stale);
      await expect(svc.updateVariant('v1', { name: 'Grande', expectedUpdatedAt: new Date(Date.now() + 10000).toISOString() })).rejects.toThrow('was modified by another user');
    });

    it('succeeds on valid update', async () => {
      const updated = { ...existing, name: 'Grande' };
      prisma.client.menuItemVariant.findFirst.mockResolvedValue(existing);
      const tx = { menuItemVariant: { update: jest.fn().mockResolvedValue(updated) }, auditLog: { create: jest.fn() } };
      prisma.client.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      const result = await svc.updateVariant('v1', { name: 'Grande' });
      expect(result.name).toBe('Grande');
      expect(audit.recordInTx).toHaveBeenCalled();
    });
  });
});
