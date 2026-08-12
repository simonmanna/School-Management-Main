/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmService } from './crm.service';

describe('CrmService', () => {
  const orgId = 'test-org';
  const userId = 'test-user';
  let prisma: any;
  let tenant: any;
  let events: any;
  let audit: any;
  let svc: CrmService;

  const dealRow = (overrides: Record<string, any> = {}) => ({
    id: 'deal-1',
    name: 'Test Deal',
    partnerId: 'partner-1',
    ownerId: userId,
    createdById: userId,
    stage: 'lead',
    amount: 1250000,
    currencyCode: 'IDR',
    expectedClose: null,
    notes: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      client: {
        deal: {
          create: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
        },
        activity: {
          create: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          update: jest.fn(),
        },
        partner: { findMany: jest.fn() },
        user: { findMany: jest.fn() },
      },
      raw: {
        deal: { findFirst: jest.fn() },
        partner: { findFirst: jest.fn(), update: jest.fn() },
        document: { findFirst: jest.fn() },
        activity: { findFirst: jest.fn(), create: jest.fn() },
      },
    };
    tenant = { organizationId: orgId, userId };
    events = { publish: jest.fn(), subscribe: jest.fn() };
    audit = { record: jest.fn() };
    svc = new CrmService(prisma as any, tenant as any, {} as any, events as any, audit as any);
  });

  describe('createDeal', () => {
    it('rejects when the partner does not exist', async () => {
      prisma.raw.partner.findFirst.mockResolvedValue(null);
      await expect(svc.createDeal({ partnerId: 'nope', name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('creates an org-scoped deal, audits it and publishes crm.deal.created', async () => {
      prisma.raw.partner.findFirst.mockResolvedValue({ id: 'partner-1' });
      prisma.client.deal.create.mockResolvedValue(dealRow());
      const out = await svc.createDeal({ partnerId: 'partner-1', name: 'Test Deal', amount: 1250000, currencyCode: 'IDR' });

      expect(out.name).toBe('Test Deal');
      expect(prisma.client.deal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            partnerId: 'partner-1',
            amount: 1250000,
            currencyCode: 'IDR',
            stage: 'lead',
            ownerId: userId,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Deal', action: 'create' }));
      expect(events.publish).toHaveBeenCalledWith('crm.deal.created', expect.anything());
    });
  });

  describe('changeStage', () => {
    it('auto-logs a deal_stage_change activity', async () => {
      prisma.client.deal.findFirst.mockResolvedValue(dealRow());
      prisma.client.deal.update.mockResolvedValue(dealRow({ stage: 'qualified' }));

      await svc.changeStage('deal-1', 'qualified');

      expect(prisma.client.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'deal_stage_change',
            dealId: 'deal-1',
            partnerId: 'partner-1',
            title: 'Stage: lead → qualified',
            organizationId: orgId,
          }),
        }),
      );
      expect(events.publish).toHaveBeenCalledWith('crm.deal.stage_changed', expect.anything());
    });

    it('converts the partner to a customer when the deal is won (F24)', async () => {
      prisma.client.deal.findFirst.mockResolvedValue(dealRow());
      prisma.client.deal.update.mockResolvedValue(dealRow({ stage: 'won' }));
      prisma.raw.partner.findFirst.mockResolvedValue({ id: 'partner-1', isCustomer: false });

      await svc.changeStage('deal-1', 'won');

      expect(prisma.raw.partner.update).toHaveBeenCalledWith({ where: { id: 'partner-1' }, data: { isCustomer: true } });
    });
  });

  describe('removeDeal', () => {
    it('soft-deletes (deletedAt), audits and publishes crm.deal.deleted', async () => {
      prisma.client.deal.findFirst.mockResolvedValue(dealRow());
      prisma.client.deal.update.mockResolvedValue(dealRow({ deletedAt: new Date() }));

      const out = await svc.removeDeal('deal-1');

      expect(out.ok).toBe(true);
      expect(prisma.client.deal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
      expect(events.publish).toHaveBeenCalledWith('crm.deal.deleted', expect.anything());
    });

    it('rejects deleting a won deal', async () => {
      prisma.client.deal.findFirst.mockResolvedValue(dealRow({ stage: 'won' }));
      await expect(svc.removeDeal('deal-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('restore + archived list', () => {
    it('restores an archived deal', async () => {
      prisma.client.deal.findFirst.mockResolvedValue(dealRow({ deletedAt: new Date() }));
      prisma.client.deal.update.mockResolvedValue(dealRow({ deletedAt: null }));

      const out = await svc.restoreDeal('deal-1');

      expect(out.deletedAt).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entity: 'Deal', action: 'restore' }));
    });

    it('lists archived deals with owner enrichment', async () => {
      prisma.client.deal.findMany.mockResolvedValue([dealRow({ deletedAt: new Date() })]);
      prisma.client.user.findMany.mockResolvedValue([{ id: userId, email: 'u@x.com', firstName: 'Admin', lastName: '' }]);

      const out = await svc.listDeletedDeals();

      expect(Array.isArray(out)).toBe(true);
      expect(out[0].name).toBe('Test Deal');
      expect((out[0] as any).owner).toEqual({ id: userId, email: 'u@x.com', name: 'Admin' });
    });
  });

  describe('listDeals pagination', () => {
    it('returns the shared { data, meta } paginated shape', async () => {
      prisma.client.deal.findMany.mockResolvedValue([dealRow()]);
      prisma.client.deal.count.mockResolvedValue(41);
      prisma.client.user.findMany.mockResolvedValue([]);

      const out = await svc.listDeals({ page: 2, pageSize: 20 });

      expect(out.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
      expect(out.data).toHaveLength(1);
    });
  });

  describe('handleInvoiceCreated (C2 deal ↔ invoice link)', () => {
    it('logs a timeline activity on the partner\'s open deal', async () => {
      prisma.raw.document.findFirst.mockResolvedValue({ id: 'doc-1', documentNumber: 'INV-001', partnerId: 'partner-1' });
      prisma.raw.activity.findFirst.mockResolvedValue(null);
      prisma.raw.deal.findFirst.mockResolvedValue({ id: 'deal-1' });

      await (svc as any).handleInvoiceCreated({ organizationId: orgId, documentId: 'doc-1', documentNumber: 'INV-001' });

      expect(prisma.raw.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            type: 'note',
            subjectType: 'Invoice',
            subjectId: 'doc-1',
            dealId: 'deal-1',
            partnerId: 'partner-1',
            title: 'Invoice INV-001 created',
          }),
        }),
      );
    });

    it('is replay-safe: skips when the activity already exists', async () => {
      prisma.raw.document.findFirst.mockResolvedValue({ id: 'doc-1', documentNumber: 'INV-001', partnerId: 'partner-1' });
      prisma.raw.activity.findFirst.mockResolvedValue({ id: 'act-1' });

      await (svc as any).handleInvoiceCreated({ organizationId: orgId, documentId: 'doc-1', documentNumber: 'INV-001' });

      expect(prisma.raw.activity.create).not.toHaveBeenCalled();
    });

    it('skips when the partner has no open deal', async () => {
      prisma.raw.document.findFirst.mockResolvedValue({ id: 'doc-1', documentNumber: 'INV-001', partnerId: 'partner-1' });
      prisma.raw.activity.findFirst.mockResolvedValue(null);
      prisma.raw.deal.findFirst.mockResolvedValue(null);

      await (svc as any).handleInvoiceCreated({ organizationId: orgId, documentId: 'doc-1', documentNumber: 'INV-001' });

      expect(prisma.raw.activity.create).not.toHaveBeenCalled();
    });

    it('subscribes to invoice.created in onModuleInit', () => {
      svc.onModuleInit();
      expect(events.subscribe).toHaveBeenCalledWith('invoice.created', expect.any(Function));
    });
  });
});
