/**
 * Reporting layer — integration proof (ADR-017).
 *
 * Two jobs:
 *
 * 1. THE MONEY PROOF. Every fee figure the report centre and the dashboards show
 *    must equal the canonical per-pupil balance, to the cent. This is the
 *    regression test for the defect this work fixed: `ReportingService` summed
 *    `Document.amountResidual` — a cached projection FINANCIAL_INVARIANTS.md
 *    forbids as an input — so the dashboard could print a different figure from
 *    the pupil's own statement. The batch `studentBalances` added to
 *    SchoolFinanceQueryService must also agree exactly with the per-pupil
 *    `studentBalance` it replaces in bulk.
 *
 * 2. THE SMOKE TEST. Iterate the WHOLE registry and run every definition. Without
 *    this, a definition whose canonical service changed signature throws only
 *    when a head teacher clicks it. It is cheap now and gets cheaper per report
 *    as the catalogue grows past 200.
 */
/**
 * Resolve grants from the tenant context rather than re-reading roles from the
 * database. PermissionResolverService defaults to DB mode (matching the guard),
 * which is right in production but means a synthetic spec user with no User row
 * resolves to NO permissions — correctly failing closed, and masking everything
 * this suite is actually here to test. Must be set before the module is built,
 * since the mode is read once at construction.
 */
process.env.PERMISSIONS_DB_LOOKUP = 'false';

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
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { BillingService, SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { AdvancedFinanceService } from '../../src/modules/school/fees/advanced.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { ReportingService } from '../../src/modules/school/reporting/reporting.service';
import { ReportRegistryService } from '../../src/modules/core/reporting/report-registry.service';
import { ReportRunnerService } from '../../src/modules/core/reporting/report-runner.service';
import { CashSessionService } from '../../src/modules/accounting/treasury/cash-session.service';
import { ScheduledReportService } from '../../src/modules/core/reporting/scheduled-report.service';
import { NotificationsService } from '../../src/kernel/notifications/notifications.service';
import { PermissionResolverService } from '../../src/kernel/auth/permission-resolver.service';
import { placeInClass } from './_placement';

describeDb('integration: school reporting', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let billing: BillingService;
  let payments: SchoolPaymentService;
  let advanced: AdvancedFinanceService;
  let finance: SchoolFinanceQueryService;
  let dashboards: ReportingService;
  let registry: ReportRegistryService;
  let runner: ReportRunnerService;

  const organizationId = `org_rpt_${Date.now()}`;
  const TUITION = 1_000_000;

  const students: Array<{ id: string; admissionNo: string }> = [];
  let classAId = '';
  let classBId = '';
  let termId = '';
  let cashRegisterId = '';
  let staffProfileId = '';

  // Every grant, so the runner's per-report check never masks a real failure
  // here. Scope and permission filtering get their own assertions below.
  const ALL_GRANTS = [
    'school:read', 'school:reports:read', 'school:reports:export',
    'school:reports:finance:read', 'school:analytics:read',
  ];

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const asUser = <T>(fn: () => Promise<T>, permissions = ALL_GRANTS): Promise<T> =>
    tenant.run({ organizationId, userId: 'head', permissions }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({
      data: { id: organizationId, code: `RPT-${Date.now()}`, name: 'Reporting School', currencyCode: 'UGX' },
    });

    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashAccountId = (await mk(organizationId, 'RPT-1100', 'Cash', 'cash')).id;
    const arAccountId = (await mk(organizationId, 'RPT-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'RPT-4100', 'Tuition Revenue', 'revenue')).id;
    for (const [code, name, type] of [
      ['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['GEN', 'General', 'general'],
    ] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    for (const [key, accountId] of [
      ['default_cash', cashAccountId], ['accounts_receivable', arAccountId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    const category = await raw.productCategory.create({
      data: { organizationId, name: 'School Fees', incomeAccountId: revenueAccountId },
    });
    const product = await raw.product.create({
      data: { organizationId, code: 'TUITION', name: 'Tuition', productType: 'service', categoryId: category.id, salesPrice: TUITION },
    });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 1', startDate: new Date('2026-01-15'), endDate: new Date('2026-04-15'), isCurrent: true },
    });
    termId = term.id;

    const gradeLevel = await raw.gradeLevel.create({ data: { organizationId, name: 'P1', order: 1 } });
    // One teacher, so the per-staff reports have a subject to run against.
    const staffPartner = await raw.partner.create({ data: { organizationId, name: 'Nakato Sarah', code: `RPT-T-${Date.now()}` } });
    staffProfileId = (await raw.staffProfile.create({
      data: { organizationId, partnerId: staffPartner.id, employeeNo: `RPT-${Date.now()}`, joinDate: new Date('2026-01-05') },
    })).id;
    classAId = (await raw.schoolClass.create({
      data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1 East', capacity: 3 },
    })).id;
    classBId = (await raw.schoolClass.create({
      data: { organizationId, gradeLevelId: gradeLevel.id, name: 'P1 West', capacity: 40 },
    })).id;

    // Four pupils: three in P1 East, one in P1 West. Enough for a class total,
    // a school total, and a class that is over capacity.
    const seed = [
      { adm: 'ADM-001', name: 'Ada Pupil', classId: classAId, gender: 'female' },
      { adm: 'ADM-002', name: 'Brian Pupil', classId: classAId, gender: 'male' },
      { adm: 'ADM-003', name: 'Carol Pupil', classId: classAId, gender: 'female' },
      { adm: 'ADM-004', name: 'Derrick Pupil', classId: classBId, gender: 'male' },
    ];
    for (const s of seed) {
      const partner = await raw.partner.create({
        data: { organizationId, code: `STU-${s.adm}`, name: s.name, isCustomer: true, receivableAccountId: arAccountId },
      });
      const student = await raw.studentProfile.create({
        data: {
          organizationId, partnerId: partner.id, admissionNo: s.adm,
          enrollmentDate: new Date('2026-01-10'),
          status: 'active', gender: s.gender, residenceType: 'day',
        },
      });
      students.push({ id: student.id, admissionNo: s.adm });
      await placeInClass(raw, { organizationId, studentProfileId: student.id, classId: s.classId });
    }

    const feeStructure = await raw.feeStructure.create({
      data: {
        organizationId, name: 'Standard Term Fees', academicYearId: year.id, status: 'published',
        components: [{ code: 'TUITION', productId: product.id, amount: TUITION }],
        applicableTo: { classIds: [classAId, classBId] },
      },
    });
    // Billing prices from the immutable published version, never the mutable
    // `components` JSON (P1-G).
    const feeVersion = await raw.feeStructureVersion.create({
      data: { organizationId, feeStructureId: feeStructure.id, versionNo: 1, isImmutable: true, publishedAt: new Date() },
    });
    await raw.feeItem.create({
      data: {
        organizationId, feeStructureVersionId: feeVersion.id, code: 'TUITION', name: 'Tuition',
        productId: product.id, amount: TUITION, isOptional: false, frequency: 'termly', appliesTo: {},
      },
    });
    await raw.feeStructure.update({ where: { id: feeStructure.id }, data: { currentVersionId: feeVersion.id } });
    await raw.feeSchedule.create({
      data: { organizationId, feeStructureId: feeStructure.id, termId, dueDate: new Date('2026-02-15') },
    });

    cashRegisterId = (await raw.cashRegister.create({
      data: { organizationId, code: 'REG-1', name: 'Bursar Drawer', defaultAccountId: cashAccountId },
    })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    billing = moduleRef.get(BillingService);
    payments = moduleRef.get(SchoolPaymentService);
    advanced = moduleRef.get(AdvancedFinanceService);
    finance = moduleRef.get(SchoolFinanceQueryService);
    dashboards = moduleRef.get(ReportingService);
    registry = moduleRef.get(ReportRegistryService);
    runner = moduleRef.get(ReportRunnerService);

    // Bill everyone, then make the four pupils differ from one another: one
    // fully paid, one part paid, one waived, one untouched.
    await asUser(() => billing.generateForTerm({ termId }));
    const session = await asUser(() => cashSession());

    await asUser(() => payments.collect({
      studentProfileId: students[0].id, amount: TUITION,
      paymentMethod: 'cash', cashSessionId: session,
    } as any));
    await asUser(() => payments.collect({
      studentProfileId: students[1].id, amount: 400_000,
      paymentMethod: 'cash', cashSessionId: session,
    } as any));

    const waiver = await asUser(() => advanced.createWaiver({
      studentProfileId: students[2].id, code: 'BURSARY-1',
      name: 'Bursary', amount: 250_000, reason: 'Hardship',
    }));
    // Maker-checker: applying forgiveness requires an approved waiver (A4).
    await raw.waiver.update({ where: { id: (waiver as any).id }, data: { status: 'approved' } });
    await asUser(() => advanced.applyWaiver((waiver as any).id));
  });

  async function cashSession(): Promise<string> {
    const svc = moduleRef.get(CashSessionService);
    const s = await svc.open({ cashRegisterId, openingFloat: 0 } as any);
    return (s as any).id;
  }

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  /* ── The money proof ──────────────────────────────────────────────────── */

  it('batch studentBalances agrees exactly with per-pupil studentBalance', async () => {
    // The batch form is a second implementation of the AR identity. If the two
    // ever drift, every class-wide and school-wide fee figure drifts with it.
    const ids = students.map((s) => s.id);
    const batch = await asUser(() => finance.studentBalances(ids));
    for (const id of ids) {
      const single = await asUser(() => finance.studentBalance(id));
      const b = batch.get(id)!;
      expect(b.billed).toBeCloseTo(single.billed, 2);
      expect(b.collected).toBeCloseTo(single.collected, 2);
      expect(b.waived).toBeCloseTo(single.waived, 2);
      expect(b.credited).toBeCloseTo(single.credited, 2);
      expect(b.adjusted).toBeCloseTo(single.adjusted, 2);
      expect(b.balance).toBeCloseTo(single.balance, 2);
      expect(b.invoiceCount).toBe(single.invoiceCount);
    }
  });

  it('the seeded pupils have the balances the events imply', async () => {
    const balances = await asUser(() => finance.studentBalances(students.map((s) => s.id)));
    expect(balances.get(students[0].id)!.balance).toBeCloseTo(0, 2);              // paid in full
    expect(balances.get(students[1].id)!.balance).toBeCloseTo(600_000, 2);        // part paid
    expect(balances.get(students[2].id)!.balance).toBeCloseTo(750_000, 2);        // waived 250k
    expect(balances.get(students[3].id)!.balance).toBeCloseTo(TUITION, 2);        // untouched
  });

  it('a waiver forgives the balance without moving collected (P0-3)', async () => {
    const b = await asUser(() => finance.studentBalance(students[2].id));
    expect(b.waived).toBeCloseTo(250_000, 2);
    // The defect this guards: a waiver that credits amountPaid makes the school
    // look like it received money it never did.
    expect(b.collected).toBeCloseTo(0, 2);
  });

  it('outstandingTotal equals the sum of POSITIVE canonical balances', async () => {
    const balances = await asUser(() => finance.studentBalances(students.map((s) => s.id)));
    const expected = [...balances.values()]
      .filter((b) => b.balance > 0)
      .reduce((t, b) => t + b.balance, 0);

    const totals = await asUser(() => finance.outstandingTotal());
    expect(totals.outstanding).toBeCloseTo(expected, 2);
    expect(totals.owingCount).toBe(3);
    expect(totals.studentCount).toBe(4);
  });

  it('the dashboard tile agrees with the canonical total (AR canon regression)', async () => {
    // Before the fix this summed Document.amountResidual and could disagree with
    // the pupil's own statement whenever the cached projection had drifted.
    const dashboardFigure = await asUser(() => dashboards.outstandingFeesTotal());
    const canonical = await asUser(() => finance.outstandingTotal());
    expect(dashboardFigure).toBeCloseTo(canonical.outstanding, 2);
  });

  it('outstandingByClass sums to the school total and attributes to the right class', async () => {
    const byClass = await asUser(() => dashboards.outstandingByClass());
    const total = byClass.reduce((t, c) => t + c.outstanding, 0);
    const canonical = await asUser(() => finance.outstandingTotal());
    expect(total).toBeCloseTo(canonical.outstanding, 2);

    const east = byClass.find((c) => c.classId === classAId)!;
    expect(east.studentCount).toBe(3);
    expect(east.owingCount).toBe(2);                       // Ada is settled
    expect(east.outstanding).toBeCloseTo(1_350_000, 2);    // 600k + 750k
  });

  it('the fee reports agree with the canonical balance', async () => {
    const clearance = await asUser(() => runner.run('fees.class-clearance', {
      page: 1, pageSize: 100, filters: { classId: classAId },
    } as any, true));
    const clearanceTotal = clearance.data.reduce((t, r) => t + Number(r.outstanding ?? 0), 0);

    const outstanding = await asUser(() => runner.run('fees.outstanding-by-student', {
      page: 1, pageSize: 100, filters: { classId: classAId },
    } as any, true));
    const outstandingTotal = outstanding.data.reduce((t, r) => t + Number(r.outstanding ?? 0), 0);

    const balances = await asUser(() => finance.studentBalances(students.slice(0, 3).map((s) => s.id)));
    const canonical = [...balances.values()].reduce((t, b) => t + Math.max(0, b.balance), 0);

    expect(clearanceTotal).toBeCloseTo(canonical, 2);
    expect(outstandingTotal).toBeCloseTo(canonical, 2);
    // The zero-balance pupil is not "outstanding fees".
    expect(outstanding.data).toHaveLength(2);
  });

  /* ── Engine behaviour against real data ───────────────────────────────── */

  it('the student register reads enrolment, not currentClassId', async () => {
    const out = await asUser(() => runner.run('student.register', {
      page: 1, pageSize: 100, filters: { termId, classId: classAId },
    } as any));
    expect(out.data).toHaveLength(3);
    expect(out.caption).toMatch(/Class basis: enrollment/);
    expect(out.data.map((r) => r.admissionNo).sort()).toEqual(['ADM-001', 'ADM-002', 'ADM-003']);
  });

  it('Wave 16: the monthly register grids every pupil against the school days', async () => {
    // Mon 2 Mar – Wed 4 Mar 2026, plus a make-up Saturday 7 Mar for one pupil.
    const [a, b, c] = students.slice(0, 3);
    const mark = (studentProfileId: string, day: number, status: string) =>
      raw.studentAttendance.create({ data: { organizationId, studentProfileId, classId: classAId, date: new Date(Date.UTC(2026, 2, day)), status } });
    await mark(a.id, 2, 'present');
    await mark(a.id, 3, 'absent');
    await mark(a.id, 4, 'present');
    await mark(a.id, 7, 'present');
    await mark(b.id, 2, 'absent');

    const out = await asUser(() => runner.run('attendance.monthly-register', {
      page: 1, pageSize: 100, filters: { classId: classAId, dateFrom: '2026-03-15' },
    } as any));
    const dayCols = out.columns.filter((col) => /^d\d+$/.test(col.key)).map((col) => col.label);
    // 22 weekdays in March 2026, plus the one Saturday that was marked; empty weekends are omitted.
    expect(dayCols).toHaveLength(23);
    expect(dayCols).toContain('7');
    expect(dayCols).not.toContain('8');

    const rowA = out.data.find((r) => r.admissionNo === a.admissionNo)!;
    expect([rowA.d2, rowA.d3, rowA.d4, rowA.d5, rowA.d7]).toEqual(['P', 'A', 'P', '', 'P']);
    expect(rowA).toMatchObject({ present: 3, absent: 1, rate: 75 });
    // A pupil on the class list with no marks still has a row.
    expect(out.data.map((r) => r.admissionNo)).toContain(c.admissionNo);
  });

  it('Wave 16: a scheduled report runs once per slot, as its creator, and stores the file', async () => {
    const saved = moduleRef.get(ScheduledReportService);
    await expect(asUser(() => saved.create({ name: 'Bad', reportKey: 'student.register', schedule: 'every monday', emailTo: ['head@school.ug'] })))
      .rejects.toThrow(/not a valid cron/);
    await expect(asUser(() => saved.create({ name: 'Spam', reportKey: 'student.register', schedule: '* * * * *', emailTo: ['head@school.ug'] })))
      .rejects.toThrow(/at most once an hour/);
    await expect(asUser(() => saved.create({ name: 'Nobody', reportKey: 'student.register', schedule: '0 7 * * 1' })))
      .rejects.toThrow(/email address/);

    const report: any = await asUser(() => saved.create({
      name: 'Monday register', reportKey: 'student.register', parameters: { termId, classId: classAId },
      schedule: '0 7 * * 1', format: 'csv', emailTo: ['head@school.ug'],
    }));

    // A scheduled run executes as its creator, who must be a live account.
    const creator = await raw.user.create({
      data: { organizationId, email: `head-${Date.now()}@school.test`, passwordHash: 'x', firstName: 'Head', lastName: 'Teacher' },
    });
    await raw.savedReport.update({ where: { id: report.id }, data: { createdById: creator.id } });

    // Grants at run time come from the creator; this suite resolves grants from
    // the tenant context, so give the scheduled run the creator's grants.
    const grants = jest.spyOn(moduleRef.get(PermissionResolverService), 'grantedForCaller').mockResolvedValue(ALL_GRANTS);
    // No SMTP in tests: make the mailer deliver, so this checks the run itself.
    const send = jest.spyOn(moduleRef.get(NotificationsService), 'send').mockResolvedValue({ id: 'n1', delivered: true });
    try {
      const future = new Date(Date.now() + 8 * 86_400_000); // at least one Monday 07:00 has passed
      await saved.tick(future);
      await saved.tick(future); // same slot: claimed already, nothing new
    } finally {
      grants.mockRestore();
      send.mockRestore();
    }
    const runs = await raw.savedReportRun.findMany({ where: { reportId: report.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('succeeded');
    expect(runs[0].deliveries).toEqual([expect.objectContaining({ recipient: 'head@school.ug', status: 'sent' })]);
    const file = await raw.file.findFirst({ where: { id: runs[0].fileId! } });
    expect(file?.contentType).toMatch(/csv/);
    expect(Number(file?.byteSize)).toBeGreaterThan(20);
  });

  it('Wave 17 R04: a failed email is recorded per recipient and retried only where it failed', async () => {
    const saved = moduleRef.get(ScheduledReportService);
    const notifications = moduleRef.get(NotificationsService);
    const report: any = await asUser(() => saved.create({
      name: 'Delivery truth', reportKey: 'student.register', parameters: { termId, classId: classAId },
      format: 'csv', emailTo: ['head@school.ug', 'bursar@school.ug'],
    }));
    const grants = jest.spyOn(moduleRef.get(PermissionResolverService), 'grantedForCaller').mockResolvedValue(ALL_GRANTS);
    const sentTo: string[] = [];
    const mailer = (fail: (to: string) => boolean) =>
      jest.spyOn(notifications, 'send').mockImplementation(async (input: any) => {
        const to = input.recipient.email;
        if (fail(to)) return { id: '', delivered: false };
        sentTo.push(to);
        return { id: 'n', delivered: true };
      });
    try {
      // Both fail: the file exists, nobody got it.
      let m = mailer(() => true);
      const both: any = await asUser(() => saved.runNow(report.id));
      m.mockRestore();
      expect(both.status).toBe('delivery_failed');
      expect(both.fileId).toBeTruthy();
      expect(both.error).toMatch(/Not delivered to 2 of 2/);

      // One fails.
      m = mailer((to) => to === 'bursar@school.ug');
      const one: any = await asUser(() => saved.runNow(report.id));
      m.mockRestore();
      expect(one.status).toBe('partial');
      expect(one.deliveries).toEqual([
        expect.objectContaining({ recipient: 'head@school.ug', status: 'sent' }),
        expect.objectContaining({ recipient: 'bursar@school.ug', status: 'failed', attempts: 1 }),
      ]);

      // Retry sends ONLY to the bursar, and the run becomes succeeded.
      sentTo.length = 0;
      m = mailer(() => false);
      const retried: any = await asUser(() => saved.retryDeliveries(one.id));
      m.mockRestore();
      expect(sentTo).toEqual(['bursar@school.ug']);
      expect(retried.status).toBe('succeeded');
      expect(retried.deliveries.find((d: any) => d.recipient === 'bursar@school.ug')).toMatchObject({ status: 'sent', attempts: 2 });

      // A run that fully succeeded cannot be "retried" into a second send.
      await expect(asUser(() => saved.retryDeliveries(one.id))).rejects.toThrow(/Only a run with failed deliveries/);
    } finally {
      grants.mockRestore();
    }
  });

  it('Wave 17 R04: a schedule whose creator was deactivated does not run', async () => {
    const saved = moduleRef.get(ScheduledReportService);
    const report: any = await asUser(() => saved.create({
      name: 'Orphan schedule', reportKey: 'student.register', parameters: { termId, classId: classAId },
      schedule: '0 6 * * 2', format: 'csv', emailTo: ['head@school.ug'],
    }));
    const gone = await raw.user.create({
      data: { organizationId, email: `left-${Date.now()}@school.test`, passwordHash: 'x', firstName: 'Former', lastName: 'Head', isActive: false },
    });
    await raw.savedReport.update({ where: { id: report.id }, data: { createdById: gone.id } });
    const send = jest.spyOn(moduleRef.get(NotificationsService), 'send');
    try {
      await saved.tick(new Date(Date.now() + 8 * 86_400_000));
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
    const runs = await raw.savedReportRun.findMany({ where: { reportId: report.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'failed', fileId: null });
    expect(runs[0].error).toMatch(/no longer has an active account/);
  });

  it('the enrolment summary reports capacity and flags an over-subscribed class', async () => {
    const out = await asUser(() => runner.run('enrollment.by-class', {
      page: 1, pageSize: 100, filters: { termId },
    } as any));
    const east = out.data.find((r) => r.className === 'P1 East')!;
    expect(east.enrolled).toBe(3);
    expect(east.capacity).toBe(3);
    expect(east.utilisation).toBeCloseTo(100, 1);
    expect(east.available).toBe(0);
  });

  it('an unknown filter is refused rather than silently ignored', async () => {
    await expect(asUser(() => runner.run('enrollment.by-class', {
      page: 1, pageSize: 25, filters: { studentProfileId: students[0].id },
    } as any))).rejects.toThrow(/does not accept filter/);
  });

  it('a caller without the finance grant cannot see or run a fee report', async () => {
    const withoutFinance = ['school:reports:read'];
    const visible = registry.catalog(withoutFinance, 'school').map((c) => c.key);
    expect(visible.some((k) => k.startsWith('fees.'))).toBe(false);
    expect(visible).toContain('student.register');

    await expect(
      asUser(() => runner.run('fees.defaulters', { page: 1, pageSize: 25, filters: {} } as any), withoutFinance),
    ).rejects.toThrow(/Missing required permission/);
  });

  /* ── Catalogue smoke ──────────────────────────────────────────────────── */

  it('every registered report runs without throwing', async () => {
    // Plausible values for whatever each definition requires. A report whose
    // canonical service changed signature fails HERE, not in front of a user.
    const supply: Record<string, unknown> = {
      termId,
      classId: classAId,
      dateFrom: '2026-01-15',
      dateTo: '2026-04-15',
      studentProfileId: students[1].id,
      // `timetable.teacher` requires a staff member. Without one in `supply` the
      // smoke test refused the report on a missing filter and never reached its
      // query — which is exactly the class of breakage this test exists to catch.
      staffProfileId: staffProfileId,
      resultSetId: undefined,
    };

    const defs = registry.all().filter((d) => {
      // Result-set reports need a published result set; this suite seeds fees
      // and enrolment, not marks. school-analytics.spec.ts covers those.
      return !(d.requiredFilters ?? []).includes('resultSetId');
    });
    expect(defs.length).toBeGreaterThan(0);

    for (const def of defs) {
      const filters: Record<string, unknown> = {};
      for (const f of def.requiredFilters ?? []) filters[f] = supply[f];
      // Offer the optional ones the definition declares too, so the filter path
      // is exercised rather than only the empty case.
      for (const f of def.filters) {
        if (filters[f] === undefined && supply[f] !== undefined && f !== 'classBasis') {
          filters[f] = supply[f];
        }
      }

      const out = await asUser(() => runner.run(def.key, {
        page: 1, pageSize: 25, filters,
      } as any));

      expect(Array.isArray(out.data)).toBe(true);
      expect(Array.isArray(out.columns)).toBe(true);
      expect(out.columns.length).toBeGreaterThan(0);
      expect(out.meta.total).toBeGreaterThanOrEqual(0);
      expect(out.key).toBe(def.key);
    }
  });
});
