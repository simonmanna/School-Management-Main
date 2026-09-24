/**
 * Academic-year lifecycle (E2E audit Y1):
 *   - saving an edit to the CURRENT year (the form re-sends isCurrent) keeps
 *     the current term; it used to clear it silently.
 *   - `/current` never returns a PLANNING year just because it sorts first.
 *   - closing a year clears its current term.
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
import { AcademicYearService } from '../../src/modules/school/foundation/academic-year.service';

describeDb('integration: academic year lifecycle (Y1)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let years: AcademicYearService;
  const stamp = Date.now();
  const organizationId = `org_w2year_${stamp}`;
  const as = <T>(fn: () => Promise<T>) =>
    tenant.run({ organizationId, userId: 'office', permissions: ['school:foundation:write'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `YR-${stamp}`, name: 'Year School', currencyCode: 'UGX' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    years = moduleRef.get(AcademicYearService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('keeps the current term through edits, returns the right /current, clears the term on close', async () => {
    // A PLANNING year that sorts first must not be reported as current.
    await raw.academicYear.create({
      data: { organizationId, name: '2030', startDate: new Date('2030-01-01'), endDate: new Date('2030-12-31') },
    });
    const y = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), isCurrent: true, status: 'ACTIVE' },
    });
    const term = await raw.term.create({
      data: { organizationId, academicYearId: y.id, name: 'Term 3', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-01'), isCurrent: true },
    });

    // The edit form re-sends isCurrent with the rename.
    await as(() => years.update(y.id, { name: '2026 (renamed)', isCurrent: true } as any));
    expect((await raw.term.findFirstOrThrow({ where: { id: term.id } })).isCurrent).toBe(true);

    const current: any = await as(() => years.current());
    expect(current?.id).toBe(y.id);

    await as(() => years.setStatus(y.id, { status: 'CLOSED' } as any));
    expect((await raw.term.findFirstOrThrow({ where: { id: term.id } })).isCurrent).toBe(false);
    expect((await raw.academicYear.findFirstOrThrow({ where: { id: y.id } })).isCurrent).toBe(false);
    // Nothing current now, and the PLANNING year is still not promoted to it.
    expect(await as(() => years.current())).toBeNull();
  });
});
