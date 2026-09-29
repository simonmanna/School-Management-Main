/**
 * Wave 16 Track C — parent portal: pick-up requests and transport.
 *
 *  - C2 a guardian's pick-up request is PENDING: not on the gate list and
 *       refused at release until someone else in the office approves it; a
 *       guardian can withdraw a collector at once.
 *  - C3 the family sees their child's route and stops, nothing about others.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { PickupService } from '../../src/modules/school/early-years/pickup.service';
import { PortalTransportService } from '../../src/modules/school/portals/portal-transport.service';
import { placeInClass } from './_placement';

describeDb('integration: Wave 16 parent portal (pick-up, transport)', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let pickup: PickupService;

  const stamp = Date.now();
  const organizationId = `org_w16_parent_${stamp}`;
  let studentProfileId = '';
  let otherStudentId = '';

  const as = <T>(userId: string, fn: () => Promise<T>) => tenant.run({ organizationId, userId, permissions: ['*'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W16P-${stamp}`, name: 'Little Stars Nursery', currencyCode: 'UGX' } });
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'Top Class', order: 3 } });
    const classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'Top Class' } })).id;
    for (const tag of ['A', 'B']) {
      const partner = await raw.partner.create({ data: { organizationId, code: `STU-P-${tag}`, name: `Child ${tag}`, isCustomer: true } });
      const s = await raw.studentProfile.create({ data: { organizationId, partnerId: partner.id, admissionNo: `ADM-P-${tag}`, enrollmentDate: new Date('2026-01-10'), status: 'active' } });
      await placeInClass(raw, { organizationId, studentProfileId: s.id, classId });
      if (tag === 'A') studentProfileId = s.id; else otherStudentId = s.id;
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    pickup = moduleRef.get(PickupService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  describe('C2 · pick-up requests', () => {
    let requestId = '';

    it('a guardian request is pending, off the gate list, and refused at release', async () => {
      const req: any = await as('parent_user', () =>
        pickup.requestFromPortal({ studentProfileId, personName: 'Auntie Sarah', personPhone: '0701234567', relationship: 'aunt' }),
      );
      requestId = req.id;
      expect(req.pendingSince).toBeTruthy();

      const family: any = await as('parent_user', () => pickup.listForFamily(studentProfileId));
      expect(family.authorizations).toEqual([expect.objectContaining({ id: requestId, name: 'Auntie Sarah', status: 'pending' })]);

      const gate: any = await as('gate_staff', () => pickup.whoMayCollect(studentProfileId));
      expect(gate.authorizations.map((a: any) => a.authorizationId)).not.toContain(requestId);

      await expect(
        as('gate_staff', () => pickup.release({ studentProfileId, authorizationId: requestId } as any)),
      ).rejects.toThrow(/not been approved/);
    });

    it('the requester cannot approve their own request; the office can', async () => {
      await expect(as('parent_user', () => pickup.approve(requestId))).rejects.toThrow(/cannot approve/);

      const queue: any[] = await as('office', () => pickup.pendingRequests());
      expect(queue.map((r) => r.id)).toContain(requestId);

      await as('office', () => pickup.approve(requestId));
      const gate: any = await as('gate_staff', () => pickup.whoMayCollect(studentProfileId));
      expect(gate.authorizations.map((a: any) => a.authorizationId)).toContain(requestId);
    });

    it('a guardian withdraws a collector at once, but only for their own child', async () => {
      await expect(as('parent_user', () => pickup.withdrawFromPortal(otherStudentId, requestId))).rejects.toThrow(/Not found/);
      await as('parent_user', () => pickup.withdrawFromPortal(studentProfileId, requestId));
      const gate: any = await as('gate_staff', () => pickup.whoMayCollect(studentProfileId));
      expect(gate.authorizations.map((a: any) => a.authorizationId)).not.toContain(requestId);
    });
  });

  describe('C3 · transport', () => {
    it('shows the child\'s route and stops, and nothing for a child with no assignment', async () => {
      const route = await raw.route.create({ data: { organizationId, name: 'Ntinda Morning', code: 'R1', status: 'active' as any } });
      const stop = await raw.stop.create({ data: { organizationId, code: 'S1', name: 'Ntinda Shopping Centre', landmark: 'Opposite the fuel station' } });
      await raw.studentTransportAssignment.create({
        data: { organizationId, studentProfileId, routeId: route.id, stopId: stop.id, pickupStopId: stop.id, startDate: new Date('2026-01-10'), status: 'active' },
      });

      const view: any = await as('parent_user', () => moduleRef.get(PortalTransportService).forFamily(studentProfileId));
      expect(view.assignments).toHaveLength(1);
      expect(view.assignments[0]).toMatchObject({ route: 'Ntinda Morning', routeCode: 'R1', status: 'active' });
      expect(view.assignments[0].pickupStop).toEqual({ name: 'Ntinda Shopping Centre', landmark: 'Opposite the fuel station' });
      expect(view.today).toEqual([]);

      const none: any = await as('parent_user', () => moduleRef.get(PortalTransportService).forFamily(otherStudentId));
      expect(none.assignments).toEqual([]);
    });
  });
});
