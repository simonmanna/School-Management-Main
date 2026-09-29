/**
 * Wave 16 — boarding. A bed is re-used after checkout (it used to be
 * single-use for the life of the database: `bedId @unique`), a pupil holds one
 * bed at a time, and the occupancy view shows who sleeps where.
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
import { HostelAllocationService } from '../../src/modules/school/library/library-transport-hostel-cafeteria.service';

describeDb('integration: Wave 16 hostel allocation', () => {
  const raw = new PrismaClient();
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let hostel: HostelAllocationService;

  const stamp = Date.now();
  const organizationId = `org_w16_hostel_${stamp}`;
  const pupils: string[] = [];
  let bedA = '';
  let bedB = '';

  const as = <T>(fn: () => Promise<T>) => tenant.run({ organizationId, userId: 'matron', permissions: ['*'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `W16H-${stamp}`, name: 'Boarding Primary', currencyCode: 'UGX' } });
    for (const tag of ['1', '2']) {
      const partner = await raw.partner.create({ data: { organizationId, code: `STU-H-${tag}`, name: `Boarder ${tag}`, isCustomer: true } });
      pupils.push((await raw.studentProfile.create({ data: { organizationId, partnerId: partner.id, admissionNo: `ADM-H-${tag}`, enrollmentDate: new Date('2026-01-10'), status: 'active' } })).id);
    }
    const dorm = await raw.dormitory.create({ data: { organizationId, name: 'Nile House', gender: 'girls' } });
    const room = await raw.room.create({ data: { organizationId, dormitoryId: dorm.id, number: '1' } });
    bedA = (await raw.bed.create({ data: { organizationId, roomId: room.id, number: 'A' } })).id;
    bedB = (await raw.bed.create({ data: { organizationId, roomId: room.id, number: 'B' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    hostel = moduleRef.get(HostelAllocationService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('re-uses a bed after checkout and keeps the history', async () => {
    const first: any = await as(() => hostel.allocate(bedA, pupils[0], new Date('2026-02-01')));
    await as(() => hostel.checkout(first.id, new Date('2026-04-30')));
    await as(() => hostel.allocate(bedA, pupils[1], new Date('2026-05-20')));
    const history = await raw.hostelAllocation.findMany({ where: { bedId: bedA }, orderBy: { startDate: 'asc' } });
    expect(history.map((h) => [h.studentProfileId, h.status])).toEqual([[pupils[0], 'ended'], [pupils[1], 'active']]);
  });

  it('refuses an occupied bed, and a second bed for the same pupil', async () => {
    await expect(as(() => hostel.allocate(bedA, pupils[0], new Date()))).rejects.toThrow(/Bed is occupied/);
    await expect(as(() => hostel.allocate(bedB, pupils[1], new Date()))).rejects.toThrow(/already has a bed/);
  });

  it('the database refuses a second active allocation even if the service is bypassed', async () => {
    await expect(
      raw.hostelAllocation.create({ data: { organizationId, bedId: bedA, studentProfileId: pupils[0], startDate: new Date() } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('shows who sleeps where', async () => {
    const view: any[] = await as(() => hostel.occupancy());
    const nile = view.find((d) => d.name === 'Nile House');
    expect(nile).toMatchObject({ beds: 2, occupied: 1 });
    const beds = nile.rooms[0].beds;
    expect(beds.find((b: any) => b.number === 'A').allocation).toMatchObject({ name: 'Boarder 2', admissionNo: 'ADM-H-2' });
    expect(beds.find((b: any) => b.number === 'B').allocation).toBeNull();
  });
});
