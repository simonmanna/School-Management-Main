/**
 * Parent notifications are delivered, once (E2E audit N1).
 *
 * The fee subscriber sent SMS/email with no userId (the channels threw) and
 * in-app rows with a null user (shown to nobody), so no guardian was ever told
 * an invoice was raised. Now each guardian is reached on their own phone/email
 * (and portal inbox when they have a login), and a re-emitted event sends
 * nothing new thanks to the DB-unique dedupe key.
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
import { FeeNotificationsSubscriber } from '../../src/modules/school/fees/fee-notifications.subscriber';

describeDb('integration: guardian notifications are delivered once (N1)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });
  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let subscriber: FeeNotificationsSubscriber;
  const stamp = Date.now();
  const organizationId = `org_w2notif_${stamp}`;
  let studentProfileId = '';

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `NT-${stamp}`, name: 'Notify School', currencyCode: 'UGX' },
    });
    const pupil = await raw.partner.create({
      data: { organizationId, code: `P-${stamp}`, name: 'Nakato Pupil', isCustomer: true },
    });
    studentProfileId = (
      await raw.studentProfile.create({
        data: { organizationId, partnerId: pupil.id, admissionNo: `N-${stamp}`, enrollmentDate: new Date() },
      })
    ).id;
    const family = await raw.partner.create({ data: { organizationId, code: `F-${stamp}`, name: 'Family', isCustomer: true } });
    const mum = await raw.contact.create({
      data: { organizationId, partnerId: family.id, firstName: 'Mum', phone: '+256772000111', email: `mum.${stamp}@example.test` },
    });
    const dad = await raw.contact.create({
      data: { organizationId, partnerId: family.id, firstName: 'Dad', phone: '+256772000222' },
    });
    const aunt = await raw.contact.create({
      data: { organizationId, partnerId: family.id, firstName: 'Aunt', phone: '+256772000333' },
    });
    for (const [c, statements] of [[mum, true], [dad, true], [aunt, false]] as const) {
      await raw.studentGuardian.create({
        data: { organizationId, studentProfileId, guardianContactId: c.id, relationship: 'guardian', receivesStatements: statements },
      });
    }

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    subscriber = moduleRef.get(FeeNotificationsSubscriber);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const invoicePosted = () =>
    tenant.run({ organizationId, userId: 'system', permissions: [] }, () =>
      (subscriber as any).onInvoicePosted({
        organizationId,
        documentId: `doc-${stamp}`,
        studentProfileId,
        amount: '450000',
      }),
    );

  it('texts each statement-receiving guardian once, and a re-emitted event sends nothing', async () => {
    await invoicePosted();
    const count = (channel: 'sms' | 'email' | 'in_app') =>
      raw.notification.count({ where: { organizationId, category: 'fees', channel } });

    expect(await count('sms')).toBe(2); // mum + dad; the aunt does not receive statements
    expect(await count('email')).toBe(1); // only mum has an address
    expect(await count('in_app')).toBe(0); // nobody has a portal login: no invisible rows
    const sms = await raw.notification.findMany({ where: { organizationId, channel: 'sms' } });
    expect(sms.every((n) => n.status === 'sent' && n.dedupeKey)).toBe(true);

    await invoicePosted();
    expect(await count('sms')).toBe(2);
    expect(await count('email')).toBe(1);
  });
});
