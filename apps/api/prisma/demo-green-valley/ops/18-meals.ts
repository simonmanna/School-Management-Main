/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 18 — meals and the cafeteria.
 *
 * Day scholars buy the lunch-and-porridge plan per term (billed through the
 * meals module onto the fee statement); nursery has its own plan with a
 * mid-morning snack; boarders eat five meals a day included in boarding fees.
 * A weekly menu a Ugandan school would recognise — posho and beans, matooke
 * and groundnut sauce, rice and beans, beef on Fridays, millet porridge at
 * break — with recipes behind each dish so the kitchen plans quantities and
 * the cost per plate. Every lunch of Terms 2 and 3 is on record class by
 * class (and every meal of Term 3), with the kitchen's daily production and
 * the odd pot of burnt beans. The tuck-shop card arrived in Term 2: parents
 * top up by mobile money and pupils buy mandazi, rolex and soda at break.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { clock, eat, addDaysIso, schoolDaysIso, momoTxnId } from './kit';
import type { Books } from './13-accounts';
import type { Pupil, Roster } from './roster';
import { NURSERY } from './roster';

const MEAL_TYPES = [
  { key: 'BREAKFAST', name: 'Breakfast', order: 1, start: '06:45', end: '07:30' },
  { key: 'PORRIDGE', name: 'Break Porridge', order: 2, start: '10:20', end: '10:40' },
  { key: 'LUNCH', name: 'Lunch', order: 3, start: '12:40', end: '13:40' },
  { key: 'EVENING', name: 'Evening Tea', order: 4, start: '16:30', end: '16:50' },
  { key: 'SUPPER', name: 'Supper', order: 5, start: '18:30', end: '19:30' },
] as const;
type MealKey = (typeof MEAL_TYPES)[number]['key'];

const PROVISIONS: Array<{ code: string; name: string; cost: number }> = [
  { code: 'KIT-MAIZE', name: 'Maize flour (posho), kg', cost: 2_360 },
  { code: 'KIT-BEANS', name: 'Dry beans (nambale), kg', cost: 4_550 },
  { code: 'KIT-RICE', name: 'Rice (super), kg', cost: 4_200 },
  { code: 'KIT-MATOOKE', name: 'Matooke, kg', cost: 1_100 },
  { code: 'KIT-GNUT', name: 'Groundnut paste, kg', cost: 9_500 },
  { code: 'KIT-CABBAGE', name: 'Cabbage, kg', cost: 1_200 },
  { code: 'KIT-PEAS', name: 'Dry peas, kg', cost: 5_200 },
  { code: 'KIT-SPOT', name: 'Sweet potatoes, kg', cost: 1_400 },
  { code: 'KIT-BEEF', name: 'Beef, kg', cost: 14_000 },
  { code: 'KIT-MILLET', name: 'Millet flour, kg', cost: 4_800 },
  { code: 'KIT-SOYAMAIZE', name: 'Soya-maize porridge flour, kg', cost: 3_200 },
  { code: 'KIT-SUGAR', name: 'Sugar, kg', cost: 4_600 },
  { code: 'KIT-OIL', name: 'Cooking oil, litre', cost: 8_000 },
  { code: 'KIT-ONION', name: 'Onions & tomatoes, kg', cost: 3_500 },
  { code: 'KIT-SALT', name: 'Salt, kg', cost: 1_500 },
  { code: 'KIT-TEA', name: 'Tea leaves, kg', cost: 18_000 },
  { code: 'KIT-MILK', name: 'Fresh milk, litre', cost: 1_200 },
  { code: 'KIT-BREAD', name: 'Bread, loaf (500g)', cost: 4_500 },
  { code: 'KIT-FRUIT', name: 'Fruit (bananas, watermelon), portion', cost: 300 },
  { code: 'KIT-CHICKEN', name: 'Chicken, kg', cost: 16_000 },
];

const RECIPES: Array<{ name: string; description: string; ingredients: Array<[string, number]> }> = [
  { name: 'Posho (ugali)', description: 'Stiff maize meal.', ingredients: [['KIT-MAIZE', 0.15]] },
  { name: 'Bean stew', description: 'Nambale beans stewed with onions and tomatoes.', ingredients: [['KIT-BEANS', 0.08], ['KIT-OIL', 0.005], ['KIT-ONION', 0.01], ['KIT-SALT', 0.002]] },
  { name: 'Steamed matooke', description: 'Matooke steamed in banana leaves.', ingredients: [['KIT-MATOOKE', 0.35]] },
  { name: 'Groundnut sauce', description: 'G-nut sauce (binyebwa).', ingredients: [['KIT-GNUT', 0.04], ['KIT-ONION', 0.008], ['KIT-SALT', 0.001]] },
  { name: 'Boiled rice', description: 'Plain rice.', ingredients: [['KIT-RICE', 0.12], ['KIT-SALT', 0.001]] },
  { name: 'Beef stew', description: 'Friday beef stew.', ingredients: [['KIT-BEEF', 0.06], ['KIT-OIL', 0.006], ['KIT-ONION', 0.012], ['KIT-SALT', 0.002]] },
  { name: 'Steamed cabbage', description: 'Cabbage with onions and tomatoes.', ingredients: [['KIT-CABBAGE', 0.06], ['KIT-OIL', 0.003], ['KIT-ONION', 0.005]] },
  { name: 'Pea stew', description: 'Dry peas stew.', ingredients: [['KIT-PEAS', 0.07], ['KIT-OIL', 0.005], ['KIT-ONION', 0.008]] },
  { name: 'Boiled sweet potatoes', description: 'Sweet potatoes, boiled.', ingredients: [['KIT-SPOT', 0.3]] },
  { name: 'Millet porridge', description: 'Bushera-style millet porridge with sugar.', ingredients: [['KIT-MILLET', 0.05], ['KIT-SUGAR', 0.02]] },
  { name: 'Soya-maize porridge', description: 'Fortified porridge with sugar.', ingredients: [['KIT-SOYAMAIZE', 0.05], ['KIT-SUGAR', 0.02]] },
  { name: 'Milk tea', description: 'African tea with milk.', ingredients: [['KIT-TEA', 0.002], ['KIT-MILK', 0.1], ['KIT-SUGAR', 0.015]] },
  { name: 'Bread (2 slices)', description: 'Sliced bread.', ingredients: [['KIT-BREAD', 0.125]] },
  { name: 'Fruit', description: 'Seasonal fruit.', ingredients: [['KIT-FRUIT', 1]] },
  { name: 'Chicken stew', description: 'Sunday chicken for boarders.', ingredients: [['KIT-CHICKEN', 0.08], ['KIT-OIL', 0.006], ['KIT-ONION', 0.012]] },
];

/** The weekly menu: meal → day of week (0 Sun … 6 Sat) → dishes. */
const MENU: Record<MealKey, Record<number, { title: string; dishes: string[] }>> = {
  BREAKFAST: {
    0: { title: 'Milk tea & bread', dishes: ['Milk tea', 'Bread (2 slices)'] },
    1: { title: 'Soya-maize porridge & bread', dishes: ['Soya-maize porridge', 'Bread (2 slices)'] },
    2: { title: 'Milk tea & bread', dishes: ['Milk tea', 'Bread (2 slices)'] },
    3: { title: 'Millet porridge & bread', dishes: ['Millet porridge', 'Bread (2 slices)'] },
    4: { title: 'Milk tea & bread', dishes: ['Milk tea', 'Bread (2 slices)'] },
    5: { title: 'Soya-maize porridge & bread', dishes: ['Soya-maize porridge', 'Bread (2 slices)'] },
    6: { title: 'Milk tea & bread', dishes: ['Milk tea', 'Bread (2 slices)'] },
  },
  PORRIDGE: {
    1: { title: 'Millet porridge', dishes: ['Millet porridge'] },
    2: { title: 'Soya-maize porridge', dishes: ['Soya-maize porridge'] },
    3: { title: 'Millet porridge', dishes: ['Millet porridge'] },
    4: { title: 'Soya-maize porridge', dishes: ['Soya-maize porridge'] },
    5: { title: 'Millet porridge', dishes: ['Millet porridge'] },
  },
  LUNCH: {
    1: { title: 'Posho & beans', dishes: ['Posho (ugali)', 'Bean stew'] },
    2: { title: 'Matooke & groundnut sauce with cabbage', dishes: ['Steamed matooke', 'Groundnut sauce', 'Steamed cabbage'] },
    3: { title: 'Rice & beans with cabbage', dishes: ['Boiled rice', 'Bean stew', 'Steamed cabbage'] },
    4: { title: 'Posho & peas, fruit', dishes: ['Posho (ugali)', 'Pea stew', 'Fruit'] },
    5: { title: 'Rice & beef stew, fruit', dishes: ['Boiled rice', 'Beef stew', 'Fruit'] },
    6: { title: 'Posho & beans', dishes: ['Posho (ugali)', 'Bean stew'] },
    0: { title: 'Rice & chicken (Sunday special)', dishes: ['Boiled rice', 'Chicken stew'] },
  },
  EVENING: {
    1: { title: 'Milk tea', dishes: ['Milk tea'] },
    2: { title: 'Milk tea', dishes: ['Milk tea'] },
    3: { title: 'Milk tea', dishes: ['Milk tea'] },
    4: { title: 'Milk tea', dishes: ['Milk tea'] },
    5: { title: 'Milk tea', dishes: ['Milk tea'] },
  },
  SUPPER: {
    0: { title: 'Posho & beans', dishes: ['Posho (ugali)', 'Bean stew'] },
    1: { title: 'Rice & beans', dishes: ['Boiled rice', 'Bean stew'] },
    2: { title: 'Posho & beans', dishes: ['Posho (ugali)', 'Bean stew'] },
    3: { title: 'Matooke & beans', dishes: ['Steamed matooke', 'Bean stew'] },
    4: { title: 'Sweet potatoes & beans', dishes: ['Boiled sweet potatoes', 'Bean stew'] },
    5: { title: 'Rice & peas', dishes: ['Boiled rice', 'Pea stew'] },
    6: { title: 'Matooke & groundnut sauce', dishes: ['Steamed matooke', 'Groundnut sauce'] },
  },
};

const TUCK_SHOP: Array<[string, number]> = [
  ['Mandazi', 500], ['Chapati', 1_000], ['Rolex (chapati & egg)', 2_500], ['Samosa', 500], ['Bottled water 500ml', 1_000],
  ['Soda 300ml', 1_500], ['Mango juice 300ml', 1_000], ['Biscuits', 500], ['Yoghurt cup', 1_500], ['Popcorn', 500],
  ['Roasted groundnuts', 500], ['Sweet bananas (2)', 500], ['Pen', 500], ['Exercise book (48 pages)', 1_000],
];
const BOARDER_SHOP: Array<[string, number]> = [['Toothpaste', 3_000], ['Bathing soap', 2_500], ['Vaseline 100ml', 3_500], ['Toilet paper', 1_000]];

export async function seedMeals(ctx: Ctx, tl: Timeline, books: Books, roster: Roster): Promise<void> {
  const { prisma, O } = ctx;
  const kitchen = ctx.svc('modules/school/meals/meal-kitchen.service', 'MealKitchenService');
  const menus = ctx.svc('modules/school/meals/meal-menu.service', 'MealMenuService');
  const mealBilling = ctx.svc('modules/school/meals/meal-billing.service', 'MealBillingService');
  const wallet = ctx.svc('modules/school/meals/meal-wallet.service', 'MealWalletService');
  const as = <T>(fn: () => Promise<T>) => ctx.as('kitchen', fn);

  // ── 1. Meal types, programmes, plans ─────────────────────────────────────
  const typeId = new Map<MealKey, string>();
  for (const t of MEAL_TYPES) {
    const row = await prisma.mealType.upsert({
      where: { organizationId_name: { organizationId: O, name: t.name } },
      update: { order: t.order, startTime: t.start, endTime: t.end, isActive: true, deletedAt: null },
      create: { organizationId: O, name: t.name, order: t.order, startTime: t.start, endTime: t.end },
    });
    typeId.set(t.key, row.id);
  }
  const program = async (name: string, kind: string, description: string) =>
    prisma.mealProgram.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: { kind, description, isActive: true },
      create: { organizationId: O, name, kind, description },
    });
  const dayProgram = await program('Day Scholars', 'day', 'Break porridge and lunch for day pupils.');
  const boardProgram = await program('Boarding Section', 'day_boarding', 'Five meals a day for boarders, included in boarding fees.');
  const shopProgram = await program('Tuck Shop', 'custom', 'Cashless tuck-shop card topped up by parents.');

  const plans = [
    { key: 'DAY', name: 'Day Lunch & Porridge', programId: dayProgram.id, price: 180_000, billing: 'term_plan', meals: ['PORRIDGE', 'LUNCH'] as MealKey[], type: 'full' },
    { key: 'NURSERY', name: 'Nursery Porridge, Snack & Lunch', programId: dayProgram.id, price: 160_000, billing: 'term_plan', meals: ['PORRIDGE', 'LUNCH'] as MealKey[], type: 'full' },
    { key: 'BOARD', name: 'Full Board (Boarders)', programId: boardProgram.id, price: 0, billing: 'included', meals: MEAL_TYPES.map((t) => t.key) as MealKey[], type: 'full' },
    { key: 'SHOP', name: 'Tuck Shop Card', programId: shopProgram.id, price: 0, billing: 'wallet', meals: [] as MealKey[], type: 'wallet' },
  ];
  const planId = new Map<string, string>();
  for (const p of plans) {
    const row = await prisma.mealPlan.upsert({
      where: { organizationId_name: { organizationId: O, name: p.name } },
      update: { pricePerTerm: p.price, billingModel: p.billing, mealProgramId: p.programId, feeProductId: p.billing === 'term_plan' ? books.productId('FEE-MEALS') : null, isActive: true, deletedAt: null },
      create: {
        organizationId: O, name: p.name, mealProgramId: p.programId, type: p.type, pricePerTerm: p.price, billingModel: p.billing,
        fundingModel: p.billing === 'included' ? 'included_in_fees' : 'parent_funded', feeProductId: p.billing === 'term_plan' ? books.productId('FEE-MEALS') : null,
      },
    });
    planId.set(p.key, row.id);
    for (const m of p.meals) {
      await prisma.mealPlanEntitlement.upsert({
        where: { organizationId_mealPlanId_mealTypeId: { organizationId: O, mealPlanId: row.id, mealTypeId: typeId.get(m)! } },
        update: {},
        create: { organizationId: O, mealPlanId: row.id, mealTypeId: typeId.get(m)! },
      });
    }
  }

  // ── 2. Provisions, recipes, the weekly menu ──────────────────────────────
  const provisionsCategory = await prisma.productCategory.upsert({
    where: { organizationId_name: { organizationId: O, name: 'Kitchen Provisions' } },
    update: { expenseAccountId: books.account('5810') },
    create: { organizationId: O, name: 'Kitchen Provisions', expenseAccountId: books.account('5810') },
  });
  const productId = new Map<string, string>();
  for (const p of PROVISIONS) {
    const row = await prisma.product.upsert({
      where: { organizationId_code: { organizationId: O, code: p.code } },
      update: { name: p.name, costPrice: p.cost, categoryId: provisionsCategory.id },
      create: { organizationId: O, code: p.code, name: p.name, productType: 'consumable', trackInventory: false, costPrice: p.cost, categoryId: provisionsCategory.id, station: 'kitchen' },
    });
    productId.set(p.code, row.id);
  }
  const recipeId = new Map<string, string>();
  for (const r of RECIPES) {
    let row = await prisma.mealRecipe.findFirst({ where: { organizationId: O, name: r.name } });
    if (!row) {
      row = await as(() =>
        kitchen.createRecipe({ name: r.name, description: r.description, portionYield: 1, ingredients: r.ingredients.map(([code, qty]) => ({ productId: productId.get(code)!, quantityPerPortion: qty })) }),
      );
    }
    recipeId.set(r.name, row!.id);
  }
  let menuCount = 0;
  for (const [meal, days] of Object.entries(MENU) as Array<[MealKey, Record<number, { title: string; dishes: string[] }>]>) {
    for (const [dow, m] of Object.entries(days)) {
      const exists = await prisma.mealMenu.findFirst({ where: { organizationId: O, mealTypeId: typeId.get(meal)!, dayOfWeek: Number(dow), deletedAt: null } });
      if (exists) continue;
      await as(() =>
        menus.create({ mealTypeId: typeId.get(meal)!, dayOfWeek: Number(dow), title: m.title, items: m.dishes.map((d, i) => ({ name: d, sortOrder: i, mealRecipeId: recipeId.get(d) })) }),
      );
      menuCount += 1;
    }
  }
  ok(`meals: ${MEAL_TYPES.length} meal types, ${plans.length} plans, ${PROVISIONS.length} provisions, ${RECIPES.length} recipes, weekly menu (${menuCount} new)`);

  // ── 3. Who eats what, term by term ───────────────────────────────────────
  const planFor = (p: Pupil): string | null => {
    if (p.residence === 'boarding') return planId.get('BOARD')!;
    if (rng(`packed-lunch:${p.id}`)() < 0.06) return null; // brings a packed lunch
    return NURSERY.includes(p.grade) ? planId.get('NURSERY')! : planId.get('DAY')!;
  };
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    tl.add({
      at: eat(addDaysIso(term.start, no === 1 ? -14 : -10), '09:30'),
      priority: 6,
      label: `meal plans ${term.name}`,
      run: async () => {
        const existing = new Set((await prisma.mealPlanAssignment.findMany({ where: { organizationId: O, termId: term.id }, select: { studentProfileId: true } })).map((a) => a.studentProfileId));
        const rows = roster.pupils
          .filter((p) => !existing.has(p.id))
          .map((p) => ({ p, plan: planFor(p) }))
          .filter((x) => x.plan)
          .map(({ p, plan }) => ({ organizationId: O, studentProfileId: p.id, mealPlanId: plan!, termId: term.id, startDate: new Date(`${term.start}T00:00:00+03:00`), endDate: new Date(`${term.end}T23:59:59+03:00`), status: 'active' as const, createdBy: ctx.users.kitchen }));
        if (rows.length) await prisma.mealPlanAssignment.createMany({ data: rows });
      },
    });
    if (no < 3) {
      tl.add({ at: eat(addDaysIso(term.end, 1), '08:00'), priority: 6, label: `meal plans end ${term.name}`, run: () => prisma.mealPlanAssignment.updateMany({ where: { organizationId: O, termId: term.id, status: 'active' }, data: { status: 'ended' } }) });
    }
    const billDay = { 1: '2026-01-23', 2: '2026-05-08', 3: '2026-08-24' }[no];
    tl.add({ at: eat(billDay, '09:15'), priority: 11, label: `meal billing ${term.name}`, run: () => ctx.as('bursar', () => mealBilling.generateMealChargesForTerm({ termId: term.id })) });
  }

  // ── 4. Daily service: sessions, attendance, production ───────────────────
  const classes = [...new Set(roster.pupils.map((p) => p.classId).filter((c): c is string => !!c))];
  const pupilsInClass = new Map(classes.map((c) => [c, roster.pupils.filter((p) => p.classId === c)]));
  const boarders = roster.pupils.filter((p) => p.residence === 'boarding');
  const eaters = (p: Pupil, meal: MealKey) => (p.residence === 'boarding' ? true : ['PORRIDGE', 'LUNCH'].includes(meal) && planFor(p) !== null);
  const recordDay = async (day: string, meals: MealKey[]) => {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const date = new Date(`${day}T00:00:00+03:00`);
    const sick = new Set(roster.pupils.filter((p) => rng(`absent:${p.id}:${day}`)() < 0.04).map((p) => p.id));
    for (const meal of meals) {
      const mt = MEAL_TYPES.find((t) => t.key === meal)!;
      // Day meals are served class by class; boarding meals in one sitting.
      const sittings: Array<{ classId: string | null; pupils: Pupil[]; planId: string | null }> =
        ['PORRIDGE', 'LUNCH'].includes(meal)
          ? classes.map((c) => ({ classId: c, pupils: pupilsInClass.get(c)!.filter((p) => eaters(p, meal)), planId: null }))
          : [{ classId: null, pupils: boarders, planId: planId.get('BOARD')! }];
      let portions = 0;
      for (const s of sittings) {
        if (s.pupils.length === 0) continue;
        let session = await prisma.mealSession.findFirst({ where: { organizationId: O, date, mealTypeId: typeId.get(meal)!, classId: s.classId } });
        if (!session) {
          session = await prisma.mealSession.create({
            data: { organizationId: O, mealTypeId: typeId.get(meal)!, date, classId: s.classId, mealPlanId: s.planId, expectedCount: s.pupils.length, status: 'closed', createdBy: ctx.users.kitchen, createdAt: eat(day, mt.start) },
          });
        }
        const rows = s.pupils.map((p) => {
          const absent = sick.has(p.id);
          return {
            organizationId: O, mealSessionId: session!.id, studentProfileId: p.id,
            status: absent ? ('absent' as const) : ('served' as const), reason: absent ? 'Absent from school' : null,
            markedById: ctx.users.kitchen, markedAt: eat(day, mt.end), createdAt: eat(day, mt.end),
          };
        });
        await prisma.mealAttendance.createMany({ data: rows, skipDuplicates: true });
        const served = rows.filter((r) => r.status === 'served').length;
        portions += served;
        await prisma.mealSession.update({ where: { id: session.id }, data: { servedCount: served } });
      }
      // Kitchen production for the meal, from the day's menu.
      const menu = MENU[meal][dow];
      if (!menu || portions === 0) continue;
      const planned = await prisma.mealProductionPlan.findFirst({ where: { organizationId: O, mealTypeId: typeId.get(meal)!, date } });
      if (planned) continue;
      clock.set(eat(addDaysIso(day, -1), '15:00'));
      const plan: any = await as(() =>
        kitchen.planProduction({ mealTypeId: typeId.get(meal)!, date: date.toISOString(), expectedPortions: Math.round(portions * 1.03), mealRecipeIds: menu.dishes.map((d) => recipeId.get(d)!) }),
      );
      for (const item of plan.items as any[]) {
        const cost = PROVISIONS.find((x) => productId.get(x.code) === item.productId)?.cost ?? 0;
        await prisma.mealProductionItem.update({ where: { id: item.id }, data: { issuedQuantity: item.plannedQuantity, consumedQuantity: item.plannedQuantity, unitCost: cost } });
      }
      await prisma.mealProductionPlan.update({ where: { id: plan.id }, data: { status: 'served', notes: menu.title, createdAt: eat(addDaysIso(day, -1), '15:00') } });
      const r = rng(`waste:${day}:${meal}`);
      if (r() < 0.12) {
        const item = pick(plan.items as any[], r);
        clock.set(eat(day, mt.end));
        await as(() =>
          kitchen.recordWaste(plan.id, {
            productId: item.productId,
            quantity: Math.round(Number(item.plannedQuantity) * (0.04 + r() * 0.06) * 100) / 100,
            reason: pick(['overproduction', 'overproduction', 'burnt', 'spoilage'], r),
            notes: pick(['Rain kept boarders indoors; less eaten.', 'Bottom of the saucepan burnt — firewood too strong.', 'Several pupils absent (sports day).', 'Leftovers given to the piggery.'], r),
          }),
        );
      }
    }
  };
  const t2Days = schoolDaysIso(roster.term(2).start, roster.term(2).end);
  const t3Days = schoolDaysIso(roster.term(3).start, ctx.asOf < roster.term(3).end ? ctx.asOf : roster.term(3).end);
  for (const day of t2Days) tl.add({ at: eat(day, '14:00'), priority: 62, label: `meal service ${day}`, run: () => recordDay(day, ['LUNCH']) });
  for (const day of t3Days) tl.add({ at: eat(day, '20:00'), priority: 62, label: `meal service ${day}`, run: () => recordDay(day, ['BREAKFAST', 'PORRIDGE', 'LUNCH', 'EVENING', 'SUPPER']) });
  log(`meal service: lunch every school day of Term 2 (${t2Days.length} days), every meal of Term 3 so far (${t3Days.length} days)`);

  // ── 5. Tuck-shop cards (from Term 2) ─────────────────────────────────────
  const cardHolders = roster.pupils.filter((p) => {
    const x = rng(`card:${p.id}`)();
    return p.residence === 'boarding' ? x < 0.8 : ['P4', 'P5', 'P6', 'P7'].includes(p.grade) && x < 0.28;
  });
  const topUpDays = (no: 2 | 3) => [addDaysIso(roster.term(no).start, 1), addDaysIso(roster.term(no).start, 40)];
  for (const no of [2, 3] as const) {
    for (const [k, day] of topUpDays(no).entries()) {
      tl.add({
        at: eat(weekday(day), '09:00'),
        priority: 63,
        label: `tuck-shop top-ups T${no}#${k + 1}`,
        run: async () => {
          const realStart = clock.realNow();
          for (const p of cardHolders) {
            const r = rng(`topup:${p.id}:${no}:${k}`);
            if (k === 1 && r() < 0.4) continue;
            const amount = pick(p.residence === 'boarding' ? [50_000, 50_000, 80_000, 100_000] : [20_000, 30_000, 50_000], r);
            const provider = r() < 0.75 ? 'MTN' : 'AIRTEL';
            await ctx.as('accounts', () =>
              wallet.topUp({ studentProfileId: p.id, mealPlanId: planId.get('SHOP')!, amount, reference: `${provider}-${momoTxnId(r, provider)}` }),
            );
          }
          await restamp(prisma, O, realStart, eat(weekday(day), '09:00'));
        },
      });
    }
  }
  const shopDays = [...schoolDaysIso(roster.term(2).start, roster.term(2).end).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3), ...t3Days.filter((d) => [2, 4].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))];
  for (const day of shopDays) {
    tl.add({
      at: eat(day, '10:30'),
      priority: 64,
      label: `tuck shop ${day}`,
      run: async () => {
        const realStart = clock.realNow();
        for (const p of cardHolders) {
          const r = rng(`shop:${p.id}:${day}`);
          if (r() < 0.25) continue;
          const account = await prisma.mealAccount.findFirst({ where: { organizationId: O, studentProfileId: p.id } });
          if (!account) continue;
          let balance = Number(account.balance);
          const basket = int(r, 1, 3);
          for (let i = 0; i < basket; i += 1) {
            const [item, price] = p.residence === 'boarding' && r() < 0.15 ? pick(BOARDER_SHOP, r) : pick(TUCK_SHOP, r);
            if (balance < price) break;
            await ctx.as('kitchen', () => wallet.purchase({ mealAccountId: account.id, amount: price, description: item, reference: `SHOP-${day}-${p.admissionNo}-${i}` }));
            balance -= price;
          }
        }
        await restamp(prisma, O, realStart, eat(day, '10:30'));
      },
    });
  }
  log(`tuck shop: ${cardHolders.length} card holders, ${topUpDays(2).length + topUpDays(3).length} top-up rounds, ${shopDays.length} shop days`);
}

/** The wallet writes rows the database dates "now"; give them the business time. */
async function restamp(prisma: Ctx['prisma'], O: string, realStart: Date, at: Date): Promise<void> {
  await prisma.mealAccountTransaction.updateMany({ where: { organizationId: O, createdAt: { gte: realStart } }, data: { createdAt: at } });
  await prisma.mealPurchase.updateMany({ where: { organizationId: O, purchasedAt: { gte: realStart } }, data: { purchasedAt: at } });
  await prisma.mealAccount.updateMany({ where: { organizationId: O, createdAt: { gte: realStart } }, data: { createdAt: at } });
}

function weekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, 1);
  return d;
}
