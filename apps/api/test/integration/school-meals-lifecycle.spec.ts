/**
 * Meals V1 integration — programs → types → plans → entitlements → assignment →
 * session → attendance. Proves against a real DB:
 *  - eligibility is DERIVED: a session's expectedCount = distinct students with an
 *    active assignment whose plan is entitled to that meal type. A day student
 *    (Lunch only) is expected for Lunch but NOT for Breakfast.
 *  - the roster lists only eligible students.
 *  - bulk meal attendance is idempotent (re-mark updates in place) and keeps
 *    MealSession.servedCount in sync.
 *  - the "one ACTIVE plan per student per term" invariant holds: re-assigning
 *    ENDS the prior active row and creates a new active one (history preserved).
 *  - attendance moves NO inventory (no MealConsumption rows exist in V1).
 *
 * Same DB requirements as the other school integration specs (RLS-inert target,
 * e.g. schooldb-planet).
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
import { StudentService } from '../../src/modules/school/people/student.service';
import {
  MealProgramService,
  MealTypeService,
  MealEntitlementService,
  MealAssignmentService,
} from '../../src/modules/school/meals/meal-config.service';
import { MealSessionService } from '../../src/modules/school/meals/meal-session.service';
import { MealWalletService } from '../../src/modules/school/meals/meal-wallet.service';

describeDb('integration: school meals V1 lifecycle', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let students: StudentService;
  let programs: MealProgramService;
  let types: MealTypeService;
  let entitlements: MealEntitlementService;
  let assignments: MealAssignmentService;
  let sessions: MealSessionService;
  let wallet: MealWalletService;

  const organizationId = `org_meals_${Date.now()}`;
  const userId = 'caterer_v1';
  let termId = '';
  let classId = '';
  let breakfastId = '';
  let lunchId = '';
  let dinnerId = '';
  let boardingPlanId = '';
  let dayPlanId = '';
  const date = '2026-05-10';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const perms = ['school:students:write', 'school:meals:write', 'school:meals:attendance', 'school:meals:wallet'];
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: perms }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({
      where: { code: 'UGX' },
      update: {},
      create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 },
    });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `MEAL-${Date.now()}`, name: 'Meals School', currencyCode: 'UGX' } });

    const year = await raw.academicYear.create({
      data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const term = await raw.term.create({
      data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-15'), isCurrent: true },
    });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    students = moduleRef.get(StudentService);
    programs = moduleRef.get(MealProgramService);
    types = moduleRef.get(MealTypeService);
    entitlements = moduleRef.get(MealEntitlementService);
    assignments = moduleRef.get(MealAssignmentService);
    sessions = moduleRef.get(MealSessionService);
    wallet = moduleRef.get(MealWalletService);

    // Program + meal types + plans + entitlements.
    await asTenant(async () => {
      const program: any = await programs.create({ name: 'Day + Boarding', kind: 'day_boarding' });
      breakfastId = (await types.create({ name: 'Breakfast', order: 1 })).id;
      lunchId = (await types.create({ name: 'Lunch', order: 2 })).id;
      dinnerId = (await types.create({ name: 'Dinner', order: 3 })).id;

      boardingPlanId = (
        await raw.mealPlan.create({
          data: { organizationId, name: 'Boarding Full', pricePerTerm: 650000, billingModel: 'term_plan', mealProgramId: program.id },
        })
      ).id;
      dayPlanId = (
        await raw.mealPlan.create({
          data: { organizationId, name: 'Day Lunch', pricePerTerm: 180000, billingModel: 'term_plan', mealProgramId: program.id },
        })
      ).id;

      await entitlements.set(boardingPlanId, [breakfastId, lunchId, dinnerId]);
      await entitlements.set(dayPlanId, [lunchId]);
    });
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  const makeStudent = (admissionNo: string) =>
    asTenant(() =>
      students.create({ name: `Student ${admissionNo}`, admissionNo, enrollmentDate: '2026-01-15', classId }),
    ) as Promise<any>;

  it('derives eligibility: boarder expected for all meals, day student only for lunch', async () => {
    const boarder = await makeStudent(`BOARD-${Date.now()}`);
    const dayStudent = await makeStudent(`DAY-${Date.now()}`);

    await asTenant(() => assignments.assign({ studentProfileId: boarder.id, mealPlanId: boardingPlanId, termId, startDate: '2026-05-01' }));
    await asTenant(() => assignments.assign({ studentProfileId: dayStudent.id, mealPlanId: dayPlanId, termId, startDate: '2026-05-01' }));

    const lunch: any = await asTenant(() => sessions.openSession({ mealTypeId: lunchId, date }));
    const breakfast: any = await asTenant(() => sessions.openSession({ mealTypeId: breakfastId, date }));

    // Lunch: both students eligible. Breakfast: only the boarder.
    expect(lunch.expectedCount).toBe(2);
    expect(breakfast.expectedCount).toBe(1);

    const lunchRoster: any = await asTenant(() => sessions.roster(lunch.id));
    expect(lunchRoster.roster).toHaveLength(2);
    const breakfastRoster: any = await asTenant(() => sessions.roster(breakfast.id));
    expect(breakfastRoster.roster).toHaveLength(1);
    expect(breakfastRoster.roster[0].studentProfileId).toBe(boarder.id);

    // Re-opening the same session is idempotent (returns the existing row).
    const lunchAgain: any = await asTenant(() => sessions.openSession({ mealTypeId: lunchId, date }));
    expect(lunchAgain.id).toBe(lunch.id);
  });

  it('marks meal attendance idempotently and keeps servedCount in sync', async () => {
    const boarder = await makeStudent(`ATT-${Date.now()}`);
    await asTenant(() => assignments.assign({ studentProfileId: boarder.id, mealPlanId: boardingPlanId, termId, startDate: '2026-05-01' }));
    const dinner: any = await asTenant(() => sessions.openSession({ mealTypeId: dinnerId, date }));

    const c1: any = await asTenant(() => sessions.markAttendance(dinner.id, { entries: [{ studentProfileId: boarder.id, status: 'absent' }] }));
    expect(c1.absent).toBe(1);
    let row = await raw.mealSession.findFirst({ where: { id: dinner.id } });
    expect(row!.servedCount).toBe(0);

    // Re-mark the SAME student served → updates in place (still one attendance row).
    const c2: any = await asTenant(() => sessions.markAttendance(dinner.id, { entries: [{ studentProfileId: boarder.id, status: 'served' }] }));
    expect(c2.served).toBe(1);
    const attRows = await raw.mealAttendance.findMany({ where: { mealSessionId: dinner.id } });
    expect(attRows).toHaveLength(1);
    row = await raw.mealSession.findFirst({ where: { id: dinner.id } });
    expect(row!.servedCount).toBe(1);
  });

  it('enforces one active plan per student per term (re-assign ends the prior active row)', async () => {
    const s = await makeStudent(`REASSIGN-${Date.now()}`);
    const first: any = await asTenant(() => assignments.assign({ studentProfileId: s.id, mealPlanId: boardingPlanId, termId, startDate: '2026-05-01' }));
    const second: any = await asTenant(() => assignments.assign({ studentProfileId: s.id, mealPlanId: dayPlanId, termId, startDate: '2026-06-01' }));

    const rows = await raw.mealPlanAssignment.findMany({ where: { studentProfileId: s.id, termId }, orderBy: { startDate: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === first.id)!.status).toBe('ended');
    expect(rows.find((r) => r.id === second.id)!.status).toBe('active');
    // Exactly one active row (the partial unique index guarantees it).
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('attendance moves no inventory (no MealConsumption in V1)', async () => {
    const consumption = await raw.mealConsumption.count({ where: { organizationId } });
    expect(consumption).toBe(0);
  });

  it('V1.5 wallet: ledger tracks top-up/purchase/refund/adjust, reconciles, and is replay-safe', async () => {
    const s = await makeStudent(`WALLET-${Date.now()}`);
    const acc: any = await asTenant(() => wallet.topUp({ studentProfileId: s.id, mealPlanId: dayPlanId, amount: 100000, reference: 'topup-1' }));

    await asTenant(() => wallet.purchase({ mealAccountId: acc.id, amount: 8000, description: 'Lunch' }));
    await asTenant(() => wallet.adjust({ mealAccountId: acc.id, amount: 5000, reason: 'goodwill' }, 'refund'));
    await asTenant(() => wallet.adjust({ mealAccountId: acc.id, amount: -2000, reason: 'correction' }, 'adjustment'));

    // 100000 - 8000 + 5000 - 2000 = 95000
    const recon: any = await asTenant(() => wallet.reconcile(acc.id));
    expect(recon.cachedBalance).toBe('95000');
    expect(recon.ledgerBalance).toBe('95000');
    expect(recon.reconciled).toBe(true);

    // Replay the SAME top-up reference → no double credit.
    await asTenant(() => wallet.topUp({ studentProfileId: s.id, mealPlanId: dayPlanId, amount: 100000, reference: 'topup-1' }));
    const recon2: any = await asTenant(() => wallet.reconcile(acc.id));
    expect(recon2.cachedBalance).toBe('95000');

    // Insufficient balance is rejected.
    await expect(asTenant(() => wallet.purchase({ mealAccountId: acc.id, amount: 999999, description: 'too much' }))).rejects.toThrow(/Insufficient/);
  });
});
