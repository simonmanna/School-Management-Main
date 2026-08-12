/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosModifiersService } from './pos-modifiers.service';

describe('PosModifiersService', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let audit: any;
  let svc: PosModifiersService;

  beforeEach(() => {
    const tx = { modifierGroup: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn() }, modifier: { update: jest.fn(), create: jest.fn() }, auditLog: { create: jest.fn() } };
    prisma = { client: { $transaction: jest.fn((cb: any) => cb(tx)), modifierGroup: { findFirst: jest.fn(), findMany: jest.fn() }, modifier: { findFirst: jest.fn() }, productModifierGroup: { count: jest.fn(), findMany: jest.fn() }, menuItemModifierGroup: { count: jest.fn(), findMany: jest.fn() }, orderItemModifier: { count: jest.fn().mockResolvedValue(0) }, invoiceItemModifier: { count: jest.fn().mockResolvedValue(0) }, documentLineModifier: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn() }, combo: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() }, comboItem: { deleteMany: jest.fn(), create: jest.fn() } } } as any;
    tenant = { organizationId: orgId, userId: 'test-user', optionalOrganizationId: orgId };
    audit = { recordInTx: jest.fn(), record: jest.fn() };
    svc = new PosModifiersService(prisma as any, tenant as any, audit as any);
  });

  describe('createGroup', () => {
    it('throws on empty name', async () => {
      await expect(svc.createGroup({ name: '' })).rejects.toThrow('Group name is required');
    });

    it('throws on minSelect > maxSelect', async () => {
      await expect(svc.createGroup({ name: 'Test', minSelect: 5, maxSelect: 1 })).rejects.toThrow('minSelect cannot be greater than maxSelect');
    });

    it('throws on duplicate name', async () => {
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce({ id: 'existing' });
      await expect(svc.createGroup({ name: 'Existing' })).rejects.toThrow('already exists');
    });
  });

  describe('updateGroup', () => {
    const existing = { id: 'g1', organizationId: orgId, name: 'Size', groupType: 'ADD_ON' as const, minSelect: 1, maxSelect: 3, isActive: true, version: 1, deletedAt: null };

    it('throws on minSelect > maxSelect', async () => {
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateGroup('g1', { minSelect: 5, maxSelect: 1 })).rejects.toThrow('minSelect cannot be greater than maxSelect');
    });

    it('throws on duplicate rename', async () => {
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce(existing);
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce({ id: 'other' });
      await expect(svc.updateGroup('g1', { name: 'Drinks' })).rejects.toThrow('already exists');
    });

    it('throws 409 on version conflict', async () => {
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce(existing);
      const tx = { modifierGroup: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
      prisma.client.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      await expect(svc.updateGroup('g1', { name: 'New', expectedVersion: 2 })).rejects.toThrow('was modified by another user');
    });

    it('succeeds on valid update', async () => {
      const updated = { ...existing, name: 'New Size', version: 2 };
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce(existing); // first call: existing check
      prisma.client.modifierGroup.findFirst.mockResolvedValueOnce(null); // second call: duplicate check
      const tx = { modifierGroup: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn().mockResolvedValue(updated) }, auditLog: { create: jest.fn() } };
      prisma.client.$transaction.mockImplementationOnce((cb: any) => cb(tx));
      const result = await svc.updateGroup('g1', { name: 'New Size', expectedVersion: 1 });
      expect(result.name).toBe('New Size');
      expect(audit.recordInTx).toHaveBeenCalled();
    });
  });

  describe('updateModifier', () => {
    const existing = { id: 'm1', organizationId: orgId, name: 'Large', priceDelta: 2, isDefault: false, isActive: true, updatedAt: new Date(), deletedAt: null };

    it('throws on negative priceDelta', async () => {
      prisma.client.modifier.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateModifier('m1', { priceDelta: -1 })).rejects.toThrow('Modifier priceDelta cannot be negative');
    });
  });

  describe('deleteModifier', () => {
    it('throws conflict if modifier is used in orders', async () => {
      const existing = { id: 'm1', organizationId: orgId, name: 'Extra Cheese', priceDelta: 2, deletedAt: null };
      prisma.client.modifier.findFirst.mockResolvedValueOnce(existing);
      prisma.client.orderItemModifier.count.mockResolvedValueOnce(3);
      await expect(svc.deleteModifier('m1')).rejects.toThrow('used in 3 historical order line(s). Deactivate instead');
    });

    it('allows deletion if modifier has no order usage', async () => {
      const existing = { id: 'm1', organizationId: orgId, name: 'Extra Cheese', priceDelta: 2, deletedAt: null };
      prisma.client.modifier.findFirst.mockResolvedValueOnce(existing);
      const txx = { modifier: { update: jest.fn().mockResolvedValue(existing) }, auditLog: { create: jest.fn() } };
      prisma.client.$transaction.mockImplementationOnce((cb: any) => cb(txx));
      await expect(svc.deleteModifier('m1')).resolves.not.toThrow();
    });
  });

  describe('createCombo', () => {
    it('throws on empty name', async () => {
      await expect(svc.createCombo({ name: '', price: 10, items: [{ productId: 'p1', quantity: 1 }] })).rejects.toThrow('Combo name is required');
    });

    it('throws on no items', async () => {
      await expect(svc.createCombo({ name: 'Breakfast', price: 10, items: [] })).rejects.toThrow('Combo must have at least one item');
    });
  });

  describe('updateCombo', () => {
    const existing = { id: 'c1', organizationId: orgId, name: 'Breakfast', price: 10, description: null, imageUrl: null };

    it('throws on empty name', async () => {
      prisma.client.combo.findFirst.mockResolvedValueOnce(existing);
      await expect(svc.updateCombo('c1', { name: '' })).rejects.toThrow('Combo name cannot be empty');
    });
  });
});
