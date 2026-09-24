/**
 * Wave 2 admissions fixes, end to end against a real database:
 *
 *   AD1  enroll and withdraw racing on one application: exactly one wins, and
 *        the history shows one transition out of the shared starting state.
 *   AD2  enrolling into a term of a different academic year is refused.
 *   AD3  an identity-match review with an invented decision is refused.
 *   AD4  an application created the way the web form creates it — guardians,
 *        no parentContactId — can be charged its admission fee.
 *
 * Setup modelled on school-admissions-concurrency.spec.ts.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { describeDb } from './_setup';
import { ensureAccountCategories, makeAccountFactory } from './_accounts';
import { ensureProgrammeRoute } from './_placement';
import { KernelModule } from '../../src/kernel/kernel.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { CoreModule } from '../../src/modules/core/core.module';
import { AccountingModule } from '../../src/modules/accounting/accounting.module';
import { InventoryModule } from '../../src/modules/inventory/inventory.module';
import { InvoicingModule } from '../../src/modules/invoicing/invoicing.module';
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { AdmissionsService } from '../../src/modules/school/admissions/admissions.service';
import { AdmissionsWorkflowService } from '../../src/modules/school/admissions/admissions-workflow.service';
import { AdmissionFeeService } from '../../src/modules/school/admissions/admission-fee.service';

describeDb('integration: wave 2 admissions (AD1–AD4)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let admissions: AdmissionsService;
  let fees: AdmissionFeeService;

  const stamp = Date.now();
  const organizationId = `org_w2adm_${stamp}`;
  const userId = 'registrar_w2';
  let academicYearId = '';
  let termId = '';
  let otherYearTermId = '';
  let classId = '';
  let cycleId = '';

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run(
      {
        organizationId,
        userId,
        permissions: ['school:admissions:write', 'school:admissions:decide', 'school:enrollment:write', 'school:admissions:fee'],
      },
      fn,
    );

  let seq = 0;
  const newApp = (extra: Record<string, unknown> = {}) => {
    seq += 1;
    return asTenant(() =>
      admissions.create({
        academicYearId,
        admissionCycleId: cycleId,
        applicantFirstName: `W2${seq}`,
        applicantLastName: `Adm${stamp}${seq}`,
        applyingForClassId: classId,
        ...extra,
      } as any),
    ) as Promise<any>;
  };

  const enroll = (applicationId: string, term = termId) =>
    asTenant(() =>
      admissions.enroll({
        applicationId,
        classId,
        termId: term,
        rollNumber: applicationId.slice(0, 8),
        student: { name: `Student ${applicationId.slice(0, 6)}` },
      } as any),
    );

  beforeAll(async () => {
    await raw.$connect();
    await raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, organizationId);
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await raw.organization.create({
      data: { id: organizationId, code: `W2A-${stamp}`, name: 'Wave2 Admissions School', currencyCode: 'UGX' },
    });

    // Ledger basics so the admission fee can post.
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cash = await mk(organizationId, 'W2-1100', 'Cash', 'cash');
    const bank = await mk(organizationId, 'W2-1200', 'Bank', 'bank');
    const ar = await mk(organizationId, 'W2-1300', 'Receivable', 'receivable');
    const revenue = await mk(organizationId, 'W2-4100', 'Revenue', 'revenue');
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'],
      ['CASH', 'Cash', 'cash'],
      ['BANK', 'Bank', 'bank'],
      ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cash.id],
      ['default_bank', bank.id],
      ['accounts_receivable', ar.id],
      ['sales_revenue', revenue.id],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    academicYearId = year.id;
    termId = (
      await raw.term.create({
        data: {
          organizationId,
          academicYearId,
          name: 'Term 1',
          startDate: new Date('2026-01-15'),
          endDate: new Date('2026-04-15'),
          isCurrent: true,
        },
      })
    ).id;
    const nextYear = await raw.academicYear.create({
      data: { organizationId, name: '2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
    });
    otherYearTermId = (
      await raw.term.create({
        data: {
          organizationId,
          academicYearId: nextYear.id,
          name: 'Term 1 (2027)',
          startDate: new Date('2027-01-15'),
          endDate: new Date('2027-04-15'),
        },
      })
    ).id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    await ensureProgrammeRoute(raw, organizationId, grade.id);
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'P1 Blue' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();
    tenant = moduleRef.get(TenantContextService);
    admissions = moduleRef.get(AdmissionsService);
    fees = moduleRef.get(AdmissionFeeService);

    const wf: any = await asTenant(() =>
      moduleRef.get(AdmissionsWorkflowService).create({ name: 'Direct', presetKey: 'simple', isDefault: true } as any),
    );
    cycleId = (
      await raw.admissionCycle.create({ data: { organizationId, academicYearId, name: 'W2 2026', workflowId: wf.id } })
    ).id;
  });

  // Placements must fall inside their term (dated-spec convention; Date only).
  beforeAll(() => {
    jest.useFakeTimers({
      now: new Date('2026-02-15T09:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
  });
  afterAll(() => jest.useRealTimers());

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('AD2: refuses to enroll into a term of another academic year', async () => {
    const app = await newApp();
    await expect(enroll(app.id, otherYearTermId)).rejects.toThrow(/not in the academic year/);
    const after = await raw.admissionApplication.findFirstOrThrow({ where: { id: app.id } });
    expect(after.status).not.toBe('enrolled');
  });

  it('AD1: enroll and withdraw racing on one application — exactly one wins', async () => {
    const app = await newApp();
    const before = (await raw.admissionApplication.findFirstOrThrow({ where: { id: app.id } })).status;
    const results = await Promise.allSettled([
      enroll(app.id),
      asTenant(() => admissions.review(app.id, 'withdraw', 'Family moved away')),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);

    const final = await raw.admissionApplication.findFirstOrThrow({ where: { id: app.id } });
    expect(['enrolled', 'withdrawn']).toContain(final.status);
    const outOfStart = await raw.admissionStatusHistory.count({
      where: { applicationId: app.id, fromStatus: before },
    });
    expect(outOfStart).toBe(1);
    // An enrolled winner has a learner; a withdrawn winner left none behind.
    const learners = await raw.studentEnrollment.count({ where: { organizationId, admissionApplicationId: app.id } });
    expect(learners).toBe(final.status === 'enrolled' ? 1 : 0);
  });

  it('AD3: an invented identity-match decision is refused', async () => {
    await expect(asTenant(() => admissions.reviewIdentityMatch('any-id', 'merge' as any))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('AD4: a web-form-shaped application (guardians, no parentContactId) can be charged', async () => {
    const app = await newApp({
      guardians: [
        { firstName: 'Mary', lastName: 'Nabirye', relationship: 'mother', phone: '0772123456', isPrimary: true },
        { firstName: 'John', lastName: 'Okello', relationship: 'father', email: `john.${stamp}@example.test`, financiallyResponsible: true },
      ],
    });
    expect(app.parentContactId ?? null).toBeNull();

    const charged: any = await asTenant(() => fees.charge(app.id, { amount: 40_000 } as any));
    const doc = await raw.document.findFirstOrThrow({ where: { id: charged.invoiceId } });
    expect(doc.status).toBe('posted');

    // Billed to the financially responsible guardian, and remembered for payment.
    const payer = await raw.partner.findFirstOrThrow({ where: { id: doc.partnerId! } });
    expect(payer.name).toBe('John Okello');
    const after = await raw.admissionApplication.findFirstOrThrow({ where: { id: app.id } });
    expect(after.parentContactId).toBeTruthy();

    await asTenant(() => fees.pay(app.id, { paymentMethod: 'cash' } as any));
    expect((await asTenant(() => fees.status(app.id))).feeStatus).toBe('paid');
  });
});
