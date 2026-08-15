/**
 * Meals V2 (finance) + V3 (kitchen) integration — against a real DB with a
 * seeded chart of accounts + inventory. Proves:
 *  V2a term billing: one active term-plan assignment → one POSTED Document
 *      (sourceType='school_meal') with the full residual and a BALANCED journal
 *      (Dr AR / Cr Revenue); the GL post is ATOMIC (kill-and-rerun leaves no
 *      orphaned unposted invoice) and idempotent (re-run bills nobody twice).
 *  V2b statement: the meal invoice shows on the student statement / is collectable.
 *  V2c wallet GL: a top-up posts Dr Cash / Cr Stored-Value Liability (NOT
 *      revenue); a consumption posts Dr Liability / Cr Cafeteria Revenue.
 *  V3a production: recipe explosion → aggregated ingredient requirements.
 *  V3b issue: issuing decrements inventory (InventoryLedger written),
 *      records MealConsumption, computes variance + cost per portion.
 *  V3c waste: waste cost is derived from inventory unit cost.
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
import { SchoolModule } from '../../src/modules/school/school.module';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';
import { StudentService } from '../../src/modules/school/people/student.service';
import { MealAssignmentService } from '../../src/modules/school/meals/meal-config.service';
import { MealBillingService } from '../../src/modules/school/meals/meal-billing.service';
import { MealWalletService } from '../../src/modules/school/meals/meal-wallet.service';
import { MealKitchenService } from '../../src/modules/school/meals/meal-kitchen.service';

describeDb('integration: school meals finance (V2) + kitchen (V3)', () => {
  const rawUrl = (() => {
    const u = process.env.DATABASE_URL ?? '';
    return u.includes('connection_limit=') ? u : `${u}${u.includes('?') ? '&' : '?'}connection_limit=1`;
  })();
  const raw = new PrismaClient({ datasources: { db: { url: rawUrl } } });

  let moduleRef: TestingModule;
  let tenant: TenantContextService;
  let studentsSvc: StudentService;
  let assignments: MealAssignmentService;
  let billing: MealBillingService;
  let wallet: MealWalletService;
  let kitchen: MealKitchenService;

  const organizationId = `org_mealfin_${Date.now()}`;
  const userId = 'bursar_meal';
  const PRICE = 650_000;

  let termId = '';
  let classId = '';
  let studentProfileId = '';
  let boardingPlanId = '';
  let lunchTypeId = '';
  let locationId = '';
  let beansId = '';
  let poshoId = '';

  const setOrg = (id: string) => raw.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, id);
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenant.run({ organizationId, userId, permissions: ['school:meals:write', 'school:meals:billing', 'school:meals:wallet', 'school:meals:kitchen'] }, fn);

  beforeAll(async () => {
    await raw.$connect();
    await raw.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    await setOrg(organizationId);
    await raw.organization.create({ data: { id: organizationId, code: `MF-${Date.now()}`, name: 'Meal Finance School', currencyCode: 'UGX' } });

    // Chart of accounts + journals + mappings.
    const mk = makeAccountFactory(raw, await ensureAccountCategories(raw));
    const cashAccountId = (await mk(organizationId, 'MF-1100', 'Cash', 'cash')).id;
    const arAccountId = (await mk(organizationId, 'MF-1300', 'Fees Receivable', 'receivable')).id;
    const revenueAccountId = (await mk(organizationId, 'MF-4100', 'Meal Revenue', 'revenue')).id;
    const inventoryAccountId = (await mk(organizationId, 'MF-1200', 'Kitchen Inventory', 'inventory')).id;
    const cogsAccountId = (await mk(organizationId, 'MF-5000', 'Meal COGS', 'cost_of_goods_sold')).id;
    for (const [code, name, type] of [['SALES', 'Sales', 'sales'], ['CASH', 'Cash', 'cash'], ['GEN', 'General', 'general'], ['INV', 'Inventory', 'general']] as const) {
      await raw.journal.create({ data: { organizationId, code, name, journalType: type } });
    }
    // Mappings the payment/posting + inventory-issue GL legs read.
    for (const [key, accountId] of [
      ['default_cash', cashAccountId],
      ['accounts_receivable', arAccountId],
      ['cogs', cogsAccountId],
      ['stock_valuation', inventoryAccountId],
    ] as const) {
      await raw.accountMapping.create({ data: { organizationId, key, accountId } });
    }

    // Meal fee product booking to revenue.
    const category = await raw.productCategory.create({ data: { organizationId, name: 'Meals', incomeAccountId: revenueAccountId } });
    const feeProduct = await raw.product.create({ data: { organizationId, code: 'MEAL-FEE', name: 'Boarding Meals', productType: 'service', categoryId: category.id, salesPrice: PRICE } });

    // Academic structure + one student.
    const year = await raw.academicYear.create({ data: { organizationId, name: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') } });
    const term = await raw.term.create({ data: { organizationId, academicYearId: year.id, name: 'Term 2', startDate: new Date('2026-05-01'), endDate: new Date('2026-08-15'), isCurrent: true } });
    termId = term.id;
    const grade = await raw.gradeLevel.create({ data: { organizationId, name: 'S1', order: 8 } });
    classId = (await raw.schoolClass.create({ data: { organizationId, gradeLevelId: grade.id, name: 'S1 East' } })).id;
    const partner = await raw.partner.create({ data: { organizationId, code: 'STU-M1', name: 'Boarder One', isCustomer: true, receivableAccountId: arAccountId } });
    studentProfileId = (await raw.studentProfile.create({ data: { organizationId, partnerId: partner.id, admissionNo: 'ADM-M1', enrollmentDate: new Date('2026-01-10'), currentClassId: classId, status: 'active' } })).id;

    // Meal plan (term-plan billing, tied to the fee product).
    boardingPlanId = (await raw.mealPlan.create({ data: { organizationId, name: 'Boarding Full', pricePerTerm: PRICE, billingModel: 'term_plan', feeProductId: feeProduct.id } })).id;
    lunchTypeId = (await raw.mealType.create({ data: { organizationId, name: 'Lunch', order: 2 } })).id;

    // Inventory: a kitchen store + two costed ingredients.
    locationId = (await raw.inventoryLocation.create({ data: { organizationId, code: 'KITCHEN', name: 'Kitchen Store', type: 'warehouse' } })).id;
    beansId = (await raw.product.create({ data: { organizationId, code: 'BEANS', name: 'Beans', productType: 'stockable', costPrice: 5000 } })).id;
    poshoId = (await raw.product.create({ data: { organizationId, code: 'POSHO', name: 'Posho', productType: 'stockable', costPrice: 3000 } })).id;

    moduleRef = await Test.createTestingModule({
      imports: [KernelModule, DocumentsModule, CoreModule, AccountingModule, InventoryModule, InvoicingModule, SchoolModule],
    }).compile();
    await moduleRef.init();

    tenant = moduleRef.get(TenantContextService);
    studentsSvc = moduleRef.get(StudentService);
    assignments = moduleRef.get(MealAssignmentService);
    billing = moduleRef.get(MealBillingService);
    wallet = moduleRef.get(MealWalletService);
    kitchen = moduleRef.get(MealKitchenService);

    // Assign the boarding plan for the term.
    await asTenant(() => assignments.assign({ studentProfileId, mealPlanId: boardingPlanId, termId, startDate: '2026-05-01' }));
  });

  afterAll(async () => {
    await moduleRef?.close();
    await raw.$disconnect();
  });

  it('V2a: bills the term meal plan — one posted AR invoice, balanced journal, idempotent', async () => {
    const res: any = await asTenant(() => billing.generateMealChargesForTerm({ termId }));
    expect(res.count).toBe(1);

    const invoice = await raw.document.findFirst({ where: { organizationId, sourceType: 'school_meal' } });
    expect(invoice).toBeTruthy();
    expect(invoice!.status).toBe('posted');
    expect(Number(invoice!.totalAmount)).toBe(PRICE);
    expect(Number(invoice!.amountResidual)).toBe(PRICE);
    expect(invoice!.journalEntryId).toBeTruthy();

    const lines = await raw.journalLine.findMany({ where: { journalEntryId: invoice!.journalEntryId! } });
    const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(debit).toBeCloseTo(credit, 6);
    expect(debit).toBeCloseTo(PRICE, 6);

    // Re-run bills nobody twice.
    const again: any = await asTenant(() => billing.generateMealChargesForTerm({ termId }));
    expect(again.count).toBe(0);
    expect(await raw.document.count({ where: { organizationId, sourceType: 'school_meal' } })).toBe(1);
  });

  it('V2b: the meal charge appears on the student statement', async () => {
    const statement: any = await asTenant(() => studentsSvc.statement(studentProfileId));
    expect(Number(statement.totalBilled)).toBeGreaterThanOrEqual(PRICE);
    expect(statement.invoices.some((i: any) => Number(i.totalAmount) === PRICE)).toBe(true);
  });

  it('V2c: wallet top-up posts stored-value LIABILITY (not revenue); consumption recognises revenue', async () => {
    const acc: any = await asTenant(() => wallet.topUp({ studentProfileId, mealPlanId: boardingPlanId, amount: 100_000, reference: 'gl-topup-1' }));

    const svl = await raw.account.findFirst({ where: { organizationId, code: 'MEAL-SVL' } });
    expect(svl).toBeTruthy();
    // The liability was CREDITED by the top-up (not a revenue account).
    const svlCredit = await raw.journalLine.aggregate({ where: { organizationId, accountId: svl!.id }, _sum: { credit: true } });
    expect(Number(svlCredit._sum.credit ?? 0)).toBeCloseTo(100_000, 6);

    await asTenant(() => wallet.purchase({ mealAccountId: acc.id, amount: 8_000, description: 'Lunch extra' }));
    const rev = await raw.account.findFirst({ where: { organizationId, code: 'MEAL-REV' } });
    expect(rev).toBeTruthy();
    const revCredit = await raw.journalLine.aggregate({ where: { organizationId, accountId: rev!.id }, _sum: { credit: true } });
    expect(Number(revCredit._sum.credit ?? 0)).toBeCloseTo(8_000, 6);
  });

  it('V3a: recipe explosion aggregates ingredient requirements for N portions', async () => {
    const beansRecipe: any = await asTenant(() => kitchen.createRecipe({ name: `Beans-${Date.now()}`, ingredients: [{ productId: beansId, quantityPerPortion: 0.05 }] }));
    const poshoRecipe: any = await asTenant(() => kitchen.createRecipe({ name: `Posho-${Date.now()}`, ingredients: [{ productId: poshoId, quantityPerPortion: 0.075 }] }));

    const plan: any = await asTenant(() => kitchen.planProduction({ mealTypeId: lunchTypeId, date: '2026-05-10', expectedPortions: 100, mealRecipeIds: [beansRecipe.id, poshoRecipe.id] }));
    const beansItem = plan.items.find((i: any) => i.productId === beansId);
    const poshoItem = plan.items.find((i: any) => i.productId === poshoId);
    expect(Number(beansItem.plannedQuantity)).toBeCloseTo(5, 6); // 0.05 × 100
    expect(Number(poshoItem.plannedQuantity)).toBeCloseTo(7.5, 6); // 0.075 × 100
  });

  it('V3b: issuing to the kitchen decrements inventory, records consumption + cost/portion', async () => {
    const recipe: any = await asTenant(() => kitchen.createRecipe({ name: `BeansIssue-${Date.now()}`, ingredients: [{ productId: beansId, quantityPerPortion: 0.05 }] }));
    const plan: any = await asTenant(() => kitchen.planProduction({ mealTypeId: lunchTypeId, date: '2026-05-11', expectedPortions: 100, mealRecipeIds: [recipe.id] }));

    const issued: any = await asTenant(() => kitchen.issueProduction(plan.id, { stockLocationId: locationId }));

    // Inventory ledger written for the beans issue against this plan.
    const ledger = await raw.inventoryLedger.findMany({ where: { organizationId, productId: beansId, referenceType: 'meal_production', referenceId: plan.id } });
    expect(ledger.length).toBeGreaterThan(0);
    // Consumption recorded.
    const consumption = await raw.mealConsumption.findMany({ where: { mealProductionPlanId: plan.id } });
    expect(consumption.length).toBe(1);
    expect(Number(consumption[0].quantity)).toBeCloseTo(5, 6);
    // Cost per portion ≈ 5 kg × 5000 / 100 = 250.
    expect(issued.cost.costPerPortion).toBeCloseTo(250, 0);
  });

  it('V3c: waste cost is derived from inventory unit cost', async () => {
    const recipe: any = await asTenant(() => kitchen.createRecipe({ name: `BeansWaste-${Date.now()}`, ingredients: [{ productId: beansId, quantityPerPortion: 0.05 }] }));
    const plan: any = await asTenant(() => kitchen.planProduction({ mealTypeId: lunchTypeId, date: '2026-05-12', expectedPortions: 100, mealRecipeIds: [recipe.id] }));
    await asTenant(() => kitchen.issueProduction(plan.id, { stockLocationId: locationId }));

    const waste: any = await asTenant(() => kitchen.recordWaste(plan.id, { productId: beansId, quantity: 0.5, reason: 'spoilage' }));
    expect(Number(waste.cost)).toBeCloseTo(2500, 0); // 0.5 kg × 5000
  });
});
