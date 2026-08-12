/**
 * Library overdue-fine integration test (H1 proof).
 *
 * Before H1 the fine invoice was created with a raw document.create that
 * omitted the required documentTypeId (it would throw) and left the document as
 * a never-posted 'draft'. This proves the fix: returning an overdue book raises
 * a POSTED AR invoice with a balanced journal, and that fine is then collectable
 * through SchoolPaymentService like any fee.
 *
 * Same DB requirements as school-happy-path.spec.ts (RLS-inert target).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { LibraryModule } from '../../src/modules/school/library/library.module';
import { FeesModule } from '../../src/modules/school/fees/fees.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BorrowingService } from '../../src/modules/school/library/library-transport-hostel-cafeteria.service';
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';

describeDb('integration: school library overdue fine (H1)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let borrowing: BorrowingService;
  let schoolPayments: SchoolPaymentService;

  const organizationId = `org_lib_${Date.now()}`;
  const userId = 'librarian_1';
  let studentProfileId = '';
  let partnerId = '';
  let bookCopyId = '';
  let bookMetadataId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `LIB-${Date.now()}`, name: 'Library School', currencyCode: 'UGX' } });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashId = (await mk(organizationId, 'LIB-1100', 'Cash', 'cash')).id;
    const arId = (await mk(organizationId, 'LIB-1300', 'Fees Receivable', 'receivable')).id;
    const incomeId = (await mk(organizationId, 'LIB-4200', 'Fine Income', 'other_income')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cashId],
      ['accounts_receivable', arId],
      // groupForPosting resolves a productless line's credit via sales_revenue.
      ['sales_revenue', incomeId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } }).catch(() => undefined);
    }

    const partner = await raw.partner.create({
      data: { organizationId, code: 'STU-LIB', name: 'Reader One', isCustomer: true, receivableAccountId: arId },
    });
    partnerId = partner.id;
    const student = await raw.studentProfile.create({
      data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-LIB', enrollmentDate: new Date(), status: 'active' },
    });
    studentProfileId = student.id;

    // A book + copy, and an already-overdue loan for that student.
    const bookProduct = await raw.product.create({
      data: { organizationId, code: 'BOOK-1', name: 'Algebra', productType: 'service', salesPrice: 0 },
    });
    const book = await raw.bookMetadata.create({
      data: { organizationId, productId: bookProduct.id, author: 'Euler' },
    });
    bookMetadataId = book.id;
    const copy = await raw.bookCopy.create({
      data: { organizationId, bookMetadataId: book.id, copyNumber: 'C-1', status: 'borrowed' },
    });
    bookCopyId = copy.id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, LibraryModule, FeesModule],
    }).compile();
    tenant = moduleRef.get(TenantContextService);
    borrowing = moduleRef.get(BorrowingService);
    schoolPayments = moduleRef.get(SchoolPaymentService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: [] }, fn);

  it('returning an overdue book raises a posted, collectable AR fine', async () => {
    // A loan due 10 days ago.
    const loan = await raw.borrowing.create({
      data: {
        organizationId,
        bookMetadataId,
        bookCopyId,
        studentProfileId,
        borrowedAt: new Date(Date.now() - 20 * 86_400_000),
        dueAt: new Date(Date.now() - 10 * 86_400_000),
        status: 'borrowed',
      },
    });

    await asTenant(() => (borrowing as any).return(loan.id));

    // Fine invoice exists, is posted, has documentTypeId, and its journal balances.
    const fine = await raw.document.findFirst({ where: { organizationId, sourceType: 'library_fine' } });
    expect(fine).toBeTruthy();
    expect(fine!.status).toBe('posted');
    expect(fine!.documentTypeId).toBeTruthy();
    const fineAmount = Number(fine!.totalAmount);
    // ~10 days overdue at UGX 200/day; ceil lands on 10 or 11 depending on the
    // sub-second gap between the fixture's dueAt and the service's `now`.
    expect([2000, 2200]).toContain(fineAmount);

    const jl = await raw.journalLine.findMany({ where: { journalEntryId: fine!.journalEntryId! } });
    const d = jl.reduce((s, l) => s + Number(l.debit), 0);
    const c = jl.reduce((s, l) => s + Number(l.credit), 0);
    expect(d).toBeCloseTo(c, 6);
    expect(d).toBeCloseTo(fineAmount, 6);

    // The fine is collectable through the normal fee-payment path.
    await asTenant(() =>
      schoolPayments.collect({ studentProfileId, amount: fineAmount, paymentMethod: 'cash' }),
    );
    const settled = await raw.document.findFirst({ where: { id: fine!.id } });
    expect(Number(settled!.amountResidual)).toBeCloseTo(0, 6);
    expect(settled!.paymentStatus).toBe('paid');
  });
});
