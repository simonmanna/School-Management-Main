/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 13 — the books.
 *
 * A school's chart of accounts, its two bank accounts and two mobile-money
 * collection wallets, monthly fiscal periods for 2026, the revenue streams the
 * fee catalogue posts to, the balances brought forward from 2025, and the
 * treasury rhythm a bursar actually keeps: cash banked weekly, mobile money
 * swept to the bank, fees moved from the collection account to operations, the
 * bus loan repaid on the 25th.
 */
import { ok, log } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, iso, addDaysIso, weekdays } from './kit';

type AccountSpec = {
  code: string;
  name: string;
  category: string;
  parent: string;
  bankName?: string;
  accountNumber?: string;
};

/** Template accounts renamed to what this school calls them. */
const RENAMES: Array<{ code: string; name: string; bankName?: string; accountNumber?: string }> = [
  { code: '1100', name: 'Cash at Hand – Bursary' },
  { code: 'CASH-DEFAULT', name: 'Cash Drawer – Fees Desk' },
  { code: '1200', name: 'Centenary Bank – Operations A/C', bankName: 'Centenary Bank', accountNumber: '3100458827' },
  { code: 'BANK-DEFAULT', name: 'Stanbic Bank – School Fees Collection A/C', bankName: 'Stanbic Bank Uganda', accountNumber: '9030014572219' },
  { code: 'MOMO-MTN', name: 'MTN Mobile Money – Fees Collections' },
  { code: 'MOMO-AIRTEL', name: 'Airtel Money – Fees Collections' },
  { code: 'PETTY', name: 'Petty Cash – Bursary' },
  { code: '1300', name: 'School Fees Receivable' },
  { code: '4100', name: 'Other School Income' },
  { code: '5200', name: 'General Operating Expenses' },
];

/** What the template does not have and a school does. */
const EXTRA_ACCOUNTS: AccountSpec[] = [
  // Fixed assets
  { code: '1610', name: 'Land & Buildings', category: 'non_current_asset', parent: '1000' },
  { code: '1620', name: 'Motor Vehicles (School Buses)', category: 'non_current_asset', parent: '1000' },
  { code: '1630', name: 'Furniture & Fittings', category: 'non_current_asset', parent: '1000' },
  { code: '1640', name: 'Computers & ICT Equipment', category: 'non_current_asset', parent: '1000' },
  { code: '1650', name: 'Kitchen & Boarding Equipment', category: 'non_current_asset', parent: '1000' },
  // Liabilities & equity
  { code: '2510', name: 'Centenary Bank Loan – School Buses', category: 'non_current_liability', parent: '2000' },
  { code: '3200', name: 'Capital Fund', category: 'equity', parent: '3000' },
  // Revenue streams
  { code: '4110', name: 'Tuition Fees', category: 'revenue', parent: '4000' },
  { code: '4120', name: 'Boarding Fees', category: 'revenue', parent: '4000' },
  { code: '4130', name: 'Transport Fees', category: 'revenue', parent: '4000' },
  { code: '4140', name: 'Meals & Catering Fees', category: 'revenue', parent: '4000' },
  { code: '4150', name: 'Development Levy', category: 'revenue', parent: '4000' },
  { code: '4160', name: 'Examination & Assessment Fees', category: 'revenue', parent: '4000' },
  { code: '4170', name: 'Admission & Registration Fees', category: 'revenue', parent: '4000' },
  { code: '4180', name: 'Uniform & Requirements Sales', category: 'revenue', parent: '4000' },
  { code: '4190', name: 'Co-curricular & Activity Fees', category: 'revenue', parent: '4000' },
  { code: '4195', name: 'Medical & Welfare Fees', category: 'revenue', parent: '4000' },
  { code: '4198', name: 'Extra Coaching & After-school Care', category: 'revenue', parent: '4000' },
  // Operating expenses (the expense categories post here)
  { code: '5810', name: 'Food & Provisions', category: 'operating_expense', parent: '5000' },
  { code: '5815', name: 'Kitchen Fuel – Firewood, Charcoal & Gas', category: 'operating_expense', parent: '5000' },
  { code: '5820', name: 'Electricity', category: 'operating_expense', parent: '5000' },
  { code: '5825', name: 'Water & Sewerage', category: 'operating_expense', parent: '5000' },
  { code: '5830', name: 'Fuel & Lubricants – School Buses', category: 'operating_expense', parent: '5000' },
  { code: '5835', name: 'Vehicle Repairs, Service & Insurance', category: 'operating_expense', parent: '5000' },
  { code: '5840', name: 'Stationery & Teaching Materials', category: 'operating_expense', parent: '5000' },
  { code: '5845', name: 'Printing & Examination Materials', category: 'operating_expense', parent: '5000' },
  { code: '5850', name: 'Repairs & Maintenance – Buildings & Furniture', category: 'operating_expense', parent: '5000' },
  { code: '5855', name: 'Cleaning & Sanitation', category: 'operating_expense', parent: '5000' },
  { code: '5860', name: 'Medical Supplies – Sick Bay', category: 'operating_expense', parent: '5000' },
  { code: '5865', name: 'Internet, Telephone & Airtime', category: 'operating_expense', parent: '5000' },
  { code: '5870', name: 'Sports, Music, Dance & Drama', category: 'operating_expense', parent: '5000' },
  { code: '5875', name: 'Staff Welfare & Development', category: 'operating_expense', parent: '5000' },
  { code: '5880', name: 'Boarding Section Supplies', category: 'operating_expense', parent: '5000' },
  { code: '5885', name: 'Security Services', category: 'operating_expense', parent: '5000' },
  { code: '5890', name: 'Licences, Subscriptions & Statutory Fees', category: 'operating_expense', parent: '5000' },
  { code: '5893', name: 'Marketing & Admissions Promotion', category: 'operating_expense', parent: '5000' },
  { code: '5896', name: 'Board & PTA Meeting Expenses', category: 'operating_expense', parent: '5000' },
  { code: '5897', name: 'Bank Charges & Mobile Money Fees', category: 'operating_expense', parent: '5000' },
  { code: '5898', name: 'Interest on Bus Loan', category: 'other_expense', parent: '5000' },
];

/** Revenue streams: product category → account, and the fee products in it. */
export const FEE_PRODUCTS: Array<{ category: string; account: string; products: Array<{ code: string; name: string }> }> = [
  { category: 'School Fees – Tuition', account: '4110', products: [{ code: 'FEE-TUITION', name: 'Tuition Fees' }] },
  { category: 'School Fees – Boarding', account: '4120', products: [{ code: 'FEE-BOARDING', name: 'Boarding Fees' }] },
  { category: 'School Fees – Transport', account: '4130', products: [{ code: 'FEE-TRANSPORT', name: 'School Transport' }] },
  { category: 'School Fees – Meals', account: '4140', products: [{ code: 'FEE-MEALS', name: 'School Meals' }] },
  { category: 'School Fees – Development', account: '4150', products: [{ code: 'FEE-DEVELOPMENT', name: 'Development Levy' }] },
  {
    category: 'School Fees – Examinations',
    account: '4160',
    products: [
      { code: 'FEE-EXAM', name: 'Examination Fee' },
      { code: 'FEE-PLE', name: 'PLE Candidate Fee' },
    ],
  },
  {
    category: 'School Fees – Admission',
    account: '4170',
    products: [
      { code: 'FEE-ADMISSION', name: 'Admission Fee' },
      { code: 'FEE-REGISTRATION', name: 'Registration Fee' },
    ],
  },
  { category: 'School Fees – Uniform', account: '4180', products: [{ code: 'FEE-UNIFORM', name: 'School Uniform Set' }] },
  {
    category: 'School Fees – Co-curricular',
    account: '4190',
    products: [
      { code: 'FEE-SWIMMING', name: 'Swimming Lessons' },
      { code: 'FEE-MUSIC', name: 'Music & Instrument Lessons' },
      { code: 'FEE-TRIP', name: 'Educational Trip' },
    ],
  },
  { category: 'School Fees – Medical', account: '4195', products: [{ code: 'FEE-MEDICAL', name: 'Medical & Sick Bay Fee' }] },
  {
    category: 'School Fees – Coaching & Care',
    account: '4198',
    products: [
      { code: 'FEE-COACHING', name: 'Extra Coaching' },
      { code: 'FEE-CARE', name: 'After-school Care' },
    ],
  },
];

/** Balances brought forward from the 2025 audited accounts (fictional). */
const OPENING: Array<{ code: string; debit?: number; credit?: number }> = [
  { code: '1610', debit: 2_450_000_000 },
  { code: '1620', debit: 486_000_000 },
  { code: '1630', debit: 128_500_000 },
  { code: '1640', debit: 64_200_000 },
  { code: '1650', debit: 72_800_000 },
  { code: '1490', credit: 318_400_000 },
  { code: 'BANK-DEFAULT', debit: 94_650_000 },
  { code: '1200', debit: 38_420_000 },
  { code: '1100', debit: 2_180_000 },
  { code: 'PETTY', debit: 500_000 },
  { code: '2510', credit: 132_000_000 },
  { code: '3200', credit: 1_800_000_000 },
];

const LOAN_INSTALMENT_PRINCIPAL = 6_000_000;
const LOAN_RATE_ANNUAL = 0.18;

export interface Books {
  account: (code: string) => string;
  productId: (code: string) => string;
  /** GL balance (debit − credit) of an account as at now. */
  balance: (code: string) => Promise<number>;
}

export async function seedAccounts(ctx: Ctx, tl: Timeline): Promise<Books> {
  const { prisma, O } = ctx;

  // ── 1. The template chart, then this school's shape on top ───────────────
  const { seedAccountingCore } = ctx.host.distModule('modules/accounting/coa/coa-seeder');
  await seedAccountingCore(prisma, O);

  const categories = new Map(
    (await prisma.accountCategory.findMany({ select: { id: true, key: true, normalBalance: true } })).map((c) => [c.key, c]),
  );
  const accountId = new Map<string, string>(
    (await prisma.account.findMany({ where: { organizationId: O }, select: { id: true, code: true } })).map((a) => [a.code, a.id]),
  );

  for (const r of RENAMES) {
    await prisma.account.updateMany({
      where: { organizationId: O, code: r.code },
      data: { name: r.name, ...(r.bankName ? { bankName: r.bankName, accountNumber: r.accountNumber } : {}) },
    });
  }
  for (const a of EXTRA_ACCOUNTS) {
    const cat = categories.get(a.category);
    if (!cat) throw new Error(`Unknown account category ${a.category}`);
    const row = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: O, code: a.code } },
      update: { name: a.name, categoryId: cat.id, parentAccountId: accountId.get(a.parent) ?? null },
      create: {
        organizationId: O,
        code: a.code,
        name: a.name,
        categoryId: cat.id,
        normalBalance: cat.normalBalance,
        parentAccountId: accountId.get(a.parent) ?? null,
        isPostable: true,
        sortOrder: Number(a.code) || 0,
      },
    });
    accountId.set(a.code, row.id);
  }
  // Treasury view of the two banks.
  for (const code of ['BANK-DEFAULT', '1200']) {
    const acc = await prisma.account.findFirstOrThrow({ where: { organizationId: O, code } });
    await prisma.bankAccount.upsert({
      where: { accountId: acc.id },
      update: { name: acc.name, bankName: acc.bankName, accountNumber: acc.accountNumber, isActive: true },
      create: { organizationId: O, accountId: acc.id, name: acc.name, bankName: acc.bankName, accountNumber: acc.accountNumber },
    });
  }
  ok(`chart of accounts: template + ${EXTRA_ACCOUNTS.length} school accounts, 2 banks, 2 mobile-money wallets`);

  // ── 2. Monthly fiscal periods for 2026 ───────────────────────────────────
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (let m = 0; m < 12; m += 1) {
    const name = `${months[m]} 2026`;
    const mm = String(m + 1).padStart(2, '0');
    const start = new Date(`2026-${mm}-01T00:00:00+03:00`);
    const nextStart = m === 11 ? new Date('2027-01-01T00:00:00+03:00') : new Date(`2026-${String(m + 2).padStart(2, '0')}-01T00:00:00+03:00`);
    const end = new Date(nextStart.getTime() - 1);
    await prisma.fiscalPeriod.upsert({
      where: { organizationId_name: { organizationId: O, name } },
      update: { startDate: start, endDate: end, deletedAt: null },
      create: { organizationId: O, name, startDate: start, endDate: end, status: 'open' },
    });
  }
  log('fiscal periods: January–December 2026, open');

  // ── 3. Revenue streams and the fee products that post to them ────────────
  const productIds = new Map<string, string>();
  for (const stream of FEE_PRODUCTS) {
    const cat = await prisma.productCategory.upsert({
      where: { organizationId_name: { organizationId: O, name: stream.category } },
      update: { incomeAccountId: accountId.get(stream.account) },
      create: { organizationId: O, name: stream.category, incomeAccountId: accountId.get(stream.account) },
    });
    for (const p of stream.products) {
      const row = await prisma.product.upsert({
        where: { organizationId_code: { organizationId: O, code: p.code } },
        update: { name: p.name, categoryId: cat.id, productType: 'fee', trackInventory: false, isActive: true },
        create: {
          organizationId: O,
          code: p.code,
          name: p.name,
          categoryId: cat.id,
          productType: 'fee',
          trackInventory: false,
          station: 'none',
        },
      });
      productIds.set(p.code, row.id);
    }
  }
  log(`revenue streams: ${FEE_PRODUCTS.length} product categories, ${productIds.size} fee products`);

  const account = (code: string): string => {
    const id = accountId.get(code);
    if (!id) throw new Error(`Account ${code} missing`);
    return id;
  };

  const balance = async (code: string): Promise<number> => {
    const agg = await prisma.journalLine.aggregate({
      where: {
        organizationId: O,
        accountId: account(code),
        entry: { status: { in: ['posted', 'reversed'] }, postingDate: { lte: new Date() } },
      },
      _sum: { baseDebit: true, baseCredit: true },
    });
    return Number(agg._sum.baseDebit ?? 0) - Number(agg._sum.baseCredit ?? 0);
  };

  const posting = ctx.svc('modules/accounting/posting/posting.service', 'PostingService');
  const post = (req: {
    journalCode: string;
    at: Date;
    description: string;
    key: string;
    sourceType: string;
    lines: Array<{ code: string; debit?: number; credit?: number; description?: string }>;
  }) =>
    ctx.as('bursar', async () => {
      // The amounts of the treasury entries are read from the ledger when they
      // run, so a replay would compute a different figure; the key decides.
      const done = await prisma.journalEntry.findFirst({ where: { organizationId: O, postingKey: req.key }, select: { id: true } });
      if (done) return done;
      return posting.post({
        journalCode: req.journalCode,
        date: req.at,
        description: req.description,
        sourceType: req.sourceType,
        postingKey: req.key,
        lines: req.lines
          .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
          .map((l) => ({
            accountId: account(l.code),
            ...(l.debit ? { debit: String(l.debit) } : {}),
            ...(l.credit ? { credit: String(l.credit) } : {}),
            description: l.description,
          })),
      });
    });

  // ── 4. Balances brought forward ──────────────────────────────────────────
  const dr = OPENING.reduce((s, l) => s + (l.debit ?? 0), 0);
  const cr = OPENING.reduce((s, l) => s + (l.credit ?? 0), 0);
  tl.add({
    at: eat('2026-01-01', '08:00'),
    priority: 0,
    label: 'opening balances',
    run: () =>
      post({
        journalCode: 'GEN',
        at: eat('2026-01-01', '08:00'),
        description: 'Balances brought forward from the 2025 audited accounts',
        key: 'demo:opening-balances:2026',
        sourceType: 'opening_balance',
        lines: [...OPENING, { code: '3100', credit: dr - cr }].map((l) => ({ ...l, description: 'Balance b/f 31 Dec 2025' })),
      }),
  });

  // ── 5. The treasury rhythm ───────────────────────────────────────────────
  // Cash banked every Friday, keeping a float of about UGX 1.5m in the safe.
  for (const day of weekdays('2026-01-09', ctx.asOf)) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 5) continue;
    tl.add({
      at: eat(day, '15:30'),
      priority: 50,
      label: `cash banking ${day}`,
      run: async () => {
        const cash = await balance('1100');
        const amount = Math.floor((cash - 1_500_000) / 100_000) * 100_000;
        if (amount < 500_000) return;
        await post({
          journalCode: 'BANK',
          at: eat(day, '15:30'),
          description: `Cash banked – Stanbic deposit slip ${day.replace(/-/g, '').slice(2)}`,
          key: `demo:cash-banking:${day}`,
          sourceType: 'bank_transfer',
          lines: [
            { code: 'BANK-DEFAULT', debit: amount, description: 'Cash deposit' },
            { code: '1100', credit: amount, description: 'Cash banked' },
          ],
        });
      },
    });
  }

  // Month end: mobile money swept to Stanbic (less the withdrawal charge), then
  // most of the fees account moved to operations; the bus loan instalment on
  // the 25th.
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const lastDay = iso(new Date(Date.UTC(2026, m, 0)));
    const sweepDay = lastWeekday(lastDay);
    for (const [code, label] of [['MOMO-MTN', 'MTN'], ['MOMO-AIRTEL', 'Airtel']] as const) {
      tl.add({
        at: eat(sweepDay, '11:00'),
        priority: 50,
        label: `${label} sweep ${mm}`,
        run: async () => {
          const held = await balance(code);
          const amount = Math.floor(held / 50_000) * 50_000;
          if (amount < 200_000) return;
          const charge = Math.min(Math.round(amount * 0.005), 150_000);
          await post({
            journalCode: 'BANK',
            at: eat(sweepDay, '11:00'),
            description: `${label} Money collections swept to Stanbic – ${months[m - 1]}`,
            key: `demo:momo-sweep:${code}:2026-${mm}`,
            sourceType: 'bank_transfer',
            lines: [
              { code: 'BANK-DEFAULT', debit: amount - charge, description: `${label} wallet withdrawal` },
              { code: '5897', debit: charge, description: `${label} withdrawal charges` },
              { code, credit: amount, description: 'Swept to bank' },
            ],
          });
        },
      });
    }
    tl.add({
      at: eat(sweepDay, '14:00'),
      priority: 51,
      label: `fees → operations ${mm}`,
      run: async () => {
        const held = await balance('BANK-DEFAULT');
        const amount = Math.floor((held * 0.75) / 1_000_000) * 1_000_000;
        if (amount < 5_000_000) return;
        await post({
          journalCode: 'BANK',
          at: eat(sweepDay, '14:00'),
          description: `Transfer – fees collection account to operations (${months[m - 1]})`,
          key: `demo:fees-to-ops:2026-${mm}`,
          sourceType: 'bank_transfer',
          lines: [
            { code: '1200', debit: amount, description: 'From Stanbic fees collection' },
            { code: 'BANK-DEFAULT', credit: amount, description: 'To Centenary operations' },
          ],
        });
      },
    });
    // Stanbic + Centenary monthly ledger fees.
    tl.add({
      at: eat(sweepDay, '16:00'),
      priority: 52,
      label: `bank charges ${mm}`,
      run: () =>
        post({
          journalCode: 'BANK',
          at: eat(sweepDay, '16:00'),
          description: `Bank ledger fees and statement charges – ${months[m - 1]}`,
          key: `demo:bank-charges:2026-${mm}`,
          sourceType: 'bank_charges',
          lines: [
            { code: '5897', debit: 38_500 + 27_000, description: 'Monthly ledger fees' },
            { code: 'BANK-DEFAULT', credit: 38_500, description: 'Stanbic ledger fee' },
            { code: '1200', credit: 27_000, description: 'Centenary ledger fee' },
          ],
        }),
    });
    const loanDay = lastWeekdayOnOrBefore(`2026-${mm}-25`);
    tl.add({
      at: eat(loanDay, '09:30'),
      priority: 52,
      label: `bus loan ${mm}`,
      run: async () => {
        const outstanding = -(await balance('2510'));
        if (outstanding <= 0) return;
        const principal = Math.min(LOAN_INSTALMENT_PRINCIPAL, outstanding);
        const interest = Math.round((outstanding * LOAN_RATE_ANNUAL) / 12 / 100) * 100;
        await post({
          journalCode: 'BANK',
          at: eat(loanDay, '09:30'),
          description: `Centenary bus loan instalment – ${months[m - 1]} 2026`,
          key: `demo:bus-loan:2026-${mm}`,
          sourceType: 'loan_repayment',
          lines: [
            { code: '2510', debit: principal, description: 'Loan principal' },
            { code: '5898', debit: interest, description: 'Loan interest @18% p.a.' },
            { code: '1200', credit: principal + interest, description: 'Standing order' },
          ],
        });
      },
    });
  }

  return {
    account,
    productId: (code: string) => {
      const id = productIds.get(code);
      if (!id) throw new Error(`Product ${code} missing`);
      return id;
    },
    balance,
  };
}

function lastWeekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, -1);
  return d;
}

function lastWeekdayOnOrBefore(isoDate: string): string {
  return lastWeekday(isoDate);
}

