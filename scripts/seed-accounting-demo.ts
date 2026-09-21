/**
 * scripts/seed-accounting-demo.ts — a realistic accounting history, so every
 * report under Accounting → Reports has something real to show.
 *
 * The reports read the ledger and nothing else. A tenant whose ledger holds a
 * handful of tuition postings will therefore render a truthful but nearly empty
 * Income Statement, an empty Supplier Ledger and a Tax Summary with no tax
 * codes — not because the reports are broken, but because those events never
 * happened. This seeds the events.
 *
 * What it posts, month by month over `SEED_MONTHS`:
 *   - opening capital, a fixed-asset purchase and opening inventory (first month)
 *   - sales invoices (Document + lines carrying a real tax code) and the AR posting
 *   - customer receipts across bank, cash and mobile money — deliberately partial,
 *     so receivables age
 *   - vendor bills (Document + lines) with recoverable input VAT, and supplier payments
 *   - cost of sales against inventory
 *   - payroll: gross, net pay, PAYE and pension, then the disbursement
 *   - rent, utilities, marketing, transport, repairs, insurance, professional
 *     fees and bank charges
 *   - monthly depreciation
 *   - sales discounts, late-fee income, a bad-debt write-off
 *   - quarterly VAT remittance, netting input tax against output tax
 *
 * Every entry balances and carries `sourceType = 'demo_accounting_seed'`, which
 * is also the ONLY thing this script will ever delete. Nothing posted by the
 * application is touched, and re-running is idempotent.
 *
 * Usage:
 *   pnpm --filter @erp/api exec tsx ../../scripts/seed-accounting-demo.ts
 *
 * Env:
 *   SEED_ORG_CODE   organisation code to seed        (default: DEMO)
 *   SEED_ORG_ID     organisation id, wins over code  (optional)
 *   SEED_MONTHS     months of history to generate    (default: 18)
 *   SEED_RESET      delete this script's prior rows  (default: true)
 */
import { Prisma, PrismaClient } from '@prisma/client';

const SOURCE_TYPE = 'demo_accounting_seed';
const ORG_CODE = process.env.SEED_ORG_CODE ?? 'DEMO';
const MONTHS = Math.max(1, Math.min(60, Number(process.env.SEED_MONTHS ?? 18)));
const RESET = (process.env.SEED_RESET ?? 'true') !== 'false';
const VAT_RATE = 18; // percent — `Tax.rate` is stored as a percentage

/**
 * Pin the pool to one connection so the `app.org_id` GUC set below holds for
 * every statement. Same reasoning as scripts/seed-school.ts.
 */
function seedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  return url.includes('connection_limit=') ? url : `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

const seedUrl = seedDatabaseUrl();
const prisma = seedUrl
  ? new PrismaClient({ datasources: { db: { url: seedUrl } } })
  : new PrismaClient();

/** Deterministic PRNG — the same command always produces the same ledger. */
let seedState = 20260904;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length) % list.length];
const between = (min: number, max: number, step = 10_000): number =>
  Math.round((min + rnd() * (max - min)) / step) * step;

const D = (v: number | string): Prisma.Decimal => new Prisma.Decimal(v);

// ─────────────────────────────── context ───────────────────────────────────

interface Ctx {
  organizationId: string;
  currencyId: string | null;
  accounts: Map<string, string>; // code -> id
  journals: Map<string, string>; // code -> id
  docTypes: Map<string, string>; // code -> id
  customers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  vatTaxId: string;
  entrySeq: number;
  docSeq: number;
}

async function resolveOrganization(): Promise<{ id: string; name: string }> {
  if (process.env.SEED_ORG_ID) {
    const org = await prisma.organization.findUnique({ where: { id: process.env.SEED_ORG_ID } });
    if (!org) throw new Error(`No organization with id ${process.env.SEED_ORG_ID}`);
    return org;
  }
  const org = await prisma.organization.findFirst({ where: { code: ORG_CODE } });
  if (!org) throw new Error(`No organization with code ${ORG_CODE}. Set SEED_ORG_CODE or SEED_ORG_ID.`);
  return org;
}

/**
 * Accounts the reports need that a stock chart may not carry. Each is created
 * against a seeded AccountCategory — never with a bare `accountType`, which is
 * the legacy mirror and is not what the reports read.
 */
const REQUIRED_ACCOUNTS: Array<{ code: string; name: string; categoryKey: string; sortOrder: number }> = [
  { code: '3200', name: 'Share Capital', categoryKey: 'equity', sortOrder: 3200 },
  { code: '5720', name: 'Rent Expense', categoryKey: 'operating_expense', sortOrder: 5720 },
  { code: '5730', name: 'Utilities Expense', categoryKey: 'operating_expense', sortOrder: 5730 },
  { code: '5740', name: 'Marketing & Advertising', categoryKey: 'operating_expense', sortOrder: 5740 },
  { code: '5750', name: 'Repairs & Maintenance', categoryKey: 'operating_expense', sortOrder: 5750 },
  { code: '5760', name: 'Insurance Expense', categoryKey: 'operating_expense', sortOrder: 5760 },
  { code: '5770', name: 'Professional Fees', categoryKey: 'operating_expense', sortOrder: 5770 },
  { code: '5780', name: 'Bank Charges', categoryKey: 'operating_expense', sortOrder: 5780 },
  { code: '5790', name: 'Transport & Fuel', categoryKey: 'operating_expense', sortOrder: 5790 },
];

async function ensureAccounts(organizationId: string): Promise<Map<string, string>> {
  const categories = await prisma.accountCategory.findMany({
    where: { key: { in: [...new Set(REQUIRED_ACCOUNTS.map((a) => a.categoryKey))] } },
    select: { id: true, key: true, normalBalance: true },
  });
  const categoryByKey = new Map(categories.map((c) => [c.key, c]));

  for (const def of REQUIRED_ACCOUNTS) {
    const existing = await prisma.account.findFirst({
      where: { organizationId, code: def.code },
      select: { id: true },
    });
    if (existing) continue;
    const category = categoryByKey.get(def.categoryKey);
    if (!category) {
      throw new Error(
        `Account category "${def.categoryKey}" is missing. Start the API once so the category seeder runs.`,
      );
    }
    await prisma.account.create({
      data: {
        organizationId,
        code: def.code,
        name: def.name,
        categoryId: category.id,
        normalBalance: category.normalBalance,
        sortOrder: def.sortOrder,
        isPostable: true,
        isActive: true,
      },
    });
    console.log(`  + account ${def.code} ${def.name}`);
  }

  const rows = await prisma.account.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, code: true },
  });
  return new Map(rows.map((a) => [a.code, a.id]));
}

/**
 * Flag the receivable and payable control accounts if the chart never did.
 * The partner ledgers prefer this flag; leaving it unset makes a tenant's
 * customer and supplier statements fall back to a broader category match.
 */
async function ensureControlAccounts(organizationId: string, accounts: Map<string, string>) {
  const wanted: Array<[string, 'ar' | 'ap' | 'inventory']> = [
    ['1300', 'ar'],
    ['2100', 'ap'],
    ['1400', 'inventory'],
  ];
  for (const [code, controlType] of wanted) {
    const id = accounts.get(code);
    if (!id) continue;
    const account = await prisma.account.findUnique({ where: { id }, select: { controlAccountType: true } });
    if (account?.controlAccountType) continue;
    await prisma.account.update({ where: { id }, data: { controlAccountType: controlType } });
    console.log(`  ~ account ${code} flagged as ${controlType.toUpperCase()} control`);
  }
}

async function ensureJournals(organizationId: string): Promise<Map<string, string>> {
  const defs: Array<{ code: string; name: string; journalType: 'general' | 'sales' | 'purchase' | 'cash' | 'bank' }> = [
    { code: 'GEN', name: 'General Journal', journalType: 'general' },
    { code: 'SALES', name: 'Sales Journal', journalType: 'sales' },
    { code: 'PURCH', name: 'Purchase Journal', journalType: 'purchase' },
    { code: 'CASH', name: 'Cash Journal', journalType: 'cash' },
    { code: 'BANK', name: 'Bank Journal', journalType: 'bank' },
  ];
  for (const def of defs) {
    const existing = await prisma.journal.findFirst({ where: { organizationId, code: def.code } });
    if (existing) continue;
    await prisma.journal.create({ data: { organizationId, ...def, isActive: true } });
    console.log(`  + journal ${def.code}`);
  }
  const rows = await prisma.journal.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, code: true },
  });
  return new Map(rows.map((j) => [j.code, j.id]));
}

async function ensureVatTax(organizationId: string): Promise<string> {
  const existing = await prisma.tax.findFirst({
    where: { organizationId, rate: D(VAT_RATE), deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.tax.create({
    data: {
      organizationId,
      name: `VAT ${VAT_RATE}%`,
      code: `VAT${VAT_RATE}`,
      type: 'vat',
      rate: D(VAT_RATE),
      vatCategory: 'standard',
      isActive: true,
    },
  });
  console.log(`  + tax VAT ${VAT_RATE}%`);
  return created.id;
}

const CUSTOMER_NAMES = [
  'Kabalagala Parents Association',
  'Nakawa Community Trust',
  'Bright Futures Foundation',
  'Mukisa Family',
  'Ssebugwawo Holdings',
  'Wandegeya Sports Club',
  'Namirembe Diocese Fund',
  'Kireka Alumni Chapter',
  'Entebbe Marine Ltd',
  'Bugolobi Residents SACCO',
];

const SUPPLIER_NAMES = [
  'Kampala Stationers Ltd',
  'Nile Foods & Catering',
  'Victoria Power Solutions',
  'Makerere Print Works',
  'Sanyu Transport Services',
  'Crane Facilities Management',
];

async function ensurePartners(organizationId: string) {
  const make = async (names: string[], prefix: string, role: 'customer' | 'supplier') => {
    const out: Array<{ id: string; name: string }> = [];
    for (const [i, name] of names.entries()) {
      const code = `${prefix}-${String(i + 1).padStart(2, '0')}`;
      const existing = await prisma.partner.findFirst({
        where: { organizationId, code },
        select: { id: true, name: true },
      });
      if (existing) {
        out.push(existing);
        continue;
      }
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
      const created = await prisma.partner.create({
        data: {
          organizationId,
          code,
          name,
          isCompany: true,
          isCustomer: role === 'customer',
          isSupplier: role === 'supplier',
          email: `${slug}@example.test`.slice(0, 120),
          phone: `+2567${String(10_000_000 + i * 137).slice(0, 8)}`,
          status: 'active',
        },
        select: { id: true, name: true },
      });
      out.push(created);
    }
    return out;
  };

  const customers = await make(CUSTOMER_NAMES, 'DEMO-CUST', 'customer');
  const suppliers = await make(SUPPLIER_NAMES, 'DEMO-SUPP', 'supplier');
  return { customers, suppliers };
}

async function resolveDocTypes(): Promise<Map<string, string>> {
  const rows = await prisma.documentTypeDef.findMany({
    where: { code: { in: ['sales_invoice', 'vendor_bill', 'credit_note'] } },
    select: { id: true, code: true },
  });
  return new Map(rows.map((d) => [d.code, d.id]));
}

// ─────────────────────────────── posting ───────────────────────────────────

interface LineInput {
  code: string;
  debit?: number;
  credit?: number;
  partnerId?: string;
  description?: string;
}

/**
 * Write one balanced journal entry. Throws rather than posting an unbalanced
 * entry — a seed that quietly breaks the trial balance is worse than no seed.
 */
async function post(
  ctx: Ctx,
  opts: { date: Date; journal: string; description: string; lines: LineInput[] },
): Promise<void> {
  let debit = 0;
  let credit = 0;
  for (const l of opts.lines) {
    debit += l.debit ?? 0;
    credit += l.credit ?? 0;
  }
  if (Math.abs(debit - credit) > 0.0001) {
    throw new Error(`Unbalanced entry "${opts.description}": Dr ${debit} vs Cr ${credit}`);
  }

  const journalId = ctx.journals.get(opts.journal);
  if (!journalId) throw new Error(`Journal ${opts.journal} not found`);

  ctx.entrySeq += 1;
  const entryNumber = `DEMO/${opts.date.getUTCFullYear()}/${String(ctx.entrySeq).padStart(6, '0')}`;

  await prisma.journalEntry.create({
    data: {
      organizationId: ctx.organizationId,
      journalId,
      entryNumber,
      postingDate: opts.date,
      description: opts.description,
      status: 'posted',
      currencyId: ctx.currencyId,
      sourceType: SOURCE_TYPE,
      postingType: 'primary',
      postedAt: opts.date,
      lines: {
        create: opts.lines.map((l, i) => {
          const accountId = ctx.accounts.get(l.code);
          if (!accountId) throw new Error(`Account ${l.code} not found in this chart`);
          return {
            organizationId: ctx.organizationId,
            accountId,
            partnerId: l.partnerId ?? null,
            description: l.description ?? opts.description,
            debit: D(l.debit ?? 0),
            credit: D(l.credit ?? 0),
            baseDebit: D(l.debit ?? 0),
            baseCredit: D(l.credit ?? 0),
            currencyId: ctx.currencyId,
            exchangeRate: D(1),
            lineNumber: i + 1,
          };
        }),
      },
    },
  });
}

/** Create a Document with one taxed line — this is what the Tax Summary reads. */
async function document(
  ctx: Ctx,
  opts: {
    typeCode: 'sales_invoice' | 'vendor_bill';
    partnerId: string;
    issueDate: Date;
    dueDate: Date;
    net: number;
    tax: number;
    description: string;
    paid: number;
  },
): Promise<void> {
  const documentTypeId = ctx.docTypes.get(opts.typeCode);
  if (!documentTypeId) throw new Error(`DocumentTypeDef ${opts.typeCode} not found`);

  ctx.docSeq += 1;
  const prefix = opts.typeCode === 'sales_invoice' ? 'DEMO-INV' : 'DEMO-BILL';
  const total = opts.net + opts.tax;
  const residual = Math.max(0, total - opts.paid);

  await prisma.document.create({
    data: {
      organizationId: ctx.organizationId,
      documentNumber: `${prefix}-${String(ctx.docSeq).padStart(6, '0')}`,
      documentType: opts.typeCode,
      documentTypeId,
      partnerId: opts.partnerId,
      currencyId: ctx.currencyId,
      exchangeRate: D(1),
      issueDate: opts.issueDate,
      dueDate: opts.dueDate,
      status: residual === 0 ? 'paid' : 'posted',
      subtotal: D(opts.net),
      taxAmount: D(opts.tax),
      totalAmount: D(total),
      amountPaid: D(opts.paid),
      amountResidual: D(residual),
      paymentStatus: residual === 0 ? 'paid' : opts.paid > 0 ? 'partial' : 'not_paid',
      sourceType: SOURCE_TYPE,
      postedAt: opts.issueDate,
      lines: {
        create: [
          {
            organizationId: ctx.organizationId,
            description: opts.description,
            quantity: D(1),
            unitPrice: D(opts.net),
            taxId: ctx.vatTaxId,
            subtotal: D(opts.net),
            taxAmount: D(opts.tax),
            total: D(total),
            lineNumber: 1,
          },
        ],
      },
    },
  });
}

// ─────────────────────────────── the history ───────────────────────────────

const day = (base: Date, d: number): Date =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), d, 9, 0, 0));

async function seedHistory(ctx: Ctx) {
  const now = new Date();
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));

  // Carried between months so receivables and payables genuinely age.
  const openReceivables: Array<{ partnerId: string; amount: number }> = [];
  const openPayables: Array<{ partnerId: string; amount: number }> = [];
  let vatOutputPool = 0;
  let vatInputPool = 0;
  // Tracked so the seeded business stays solvent: cost of sales is charged
  // against stock actually bought, and takings are swept to the bank rather
  // than left to accumulate in the cash drawer while the bank goes overdrawn.
  let inventoryBalance = 0;
  let cashOnHand = 0;
  let momoOnHand = 0;
  let statutoryDue = { paye: 0, pension: 0 };

  for (let m = 0; m < MONTHS; m += 1) {
    const month = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + m, 1));
    const isLastMonth = m === MONTHS - 1;
    const monthEndDay = isLastMonth
      ? Math.max(1, now.getUTCDate() - 1)
      : new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();

    // ── capital structure, first month only ──────────────────────────────
    if (m === 0) {
      await post(ctx, {
        date: day(month, 1),
        journal: 'GEN',
        description: 'Opening capital injection',
        lines: [
          { code: '1200', debit: 250_000_000 },
          { code: '3200', credit: 250_000_000 },
        ],
      });
      await post(ctx, {
        date: day(month, 2),
        journal: 'BANK',
        description: 'Purchase of furniture, IT and vehicles',
        lines: [
          { code: '1600', debit: 120_000_000 },
          { code: '1200', credit: 120_000_000 },
        ],
      });
      const opener = ctx.suppliers[0];
      await post(ctx, {
        date: day(month, 3),
        journal: 'PURCH',
        description: 'Opening inventory purchase',
        lines: [
          { code: '1400', debit: 40_000_000 },
          { code: '2100', credit: 40_000_000, partnerId: opener.id },
        ],
      });
      openPayables.push({ partnerId: opener.id, amount: 40_000_000 });
      inventoryBalance += 40_000_000;
    }

    // ── sales ────────────────────────────────────────────────────────────
    const invoiceCount = 6 + Math.floor(rnd() * 5);
    let monthNet = 0;
    for (let i = 0; i < invoiceCount; i += 1) {
      const customer = pick(ctx.customers);
      const net = between(2_500_000, 16_000_000, 50_000);
      const tax = Math.round((net * VAT_RATE) / 100);
      const gross = net + tax;
      const issueDay = Math.min(monthEndDay, 2 + Math.floor(rnd() * 24));
      const issued = day(month, issueDay);
      const due = new Date(issued.getTime() + 30 * 86_400_000);
      monthNet += net;
      vatOutputPool += tax;

      await post(ctx, {
        date: issued,
        journal: 'SALES',
        description: `Invoice — ${customer.name}`,
        lines: [
          { code: '1300', debit: gross, partnerId: customer.id },
          { code: '4100', credit: net },
          { code: '2200', credit: tax, description: 'Output VAT' },
        ],
      });

      // Most invoices settle inside the month; the rest age into receivables.
      const settles = rnd() < 0.7;
      const paid = settles ? gross : 0;
      await document(ctx, {
        typeCode: 'sales_invoice',
        partnerId: customer.id,
        issueDate: issued,
        dueDate: due,
        net,
        tax,
        description: 'Tuition, boarding and services',
        paid,
      });

      if (settles) {
        // Most fees are banked; a minority come over the counter or by mobile
        // money, which the monthly sweep below moves to the bank.
        const roll = rnd();
        let tender = roll < 0.7 ? '1200' : roll < 0.9 ? '1100' : 'MOMO-MTN';
        if (!ctx.accounts.has(tender)) tender = '1200';
        if (tender === '1100') cashOnHand += gross;
        if (tender === 'MOMO-MTN') momoOnHand += gross;
        await post(ctx, {
          date: day(month, Math.min(monthEndDay, issueDay + 3)),
          journal: tender === '1200' ? 'BANK' : 'CASH',
          description: `Receipt — ${customer.name}`,
          lines: [
            { code: tender, debit: gross },
            { code: '1300', credit: gross, partnerId: customer.id },
          ],
        });
      } else {
        openReceivables.push({ partnerId: customer.id, amount: gross });
      }
    }

    // Some aged receivables get collected in a later month.
    for (let i = openReceivables.length - 1; i >= 0; i -= 1) {
      if (rnd() > 0.45) continue;
      const owed = openReceivables.splice(i, 1)[0];
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 5 + Math.floor(rnd() * 20))),
        journal: 'BANK',
        description: 'Receipt against aged invoice',
        lines: [
          { code: '1200', debit: owed.amount },
          { code: '1300', credit: owed.amount, partnerId: owed.partnerId },
        ],
      });
    }

    // ── cost of sales ────────────────────────────────────────────────────
    // Charged against stock on hand, never against revenue directly — issuing
    // more to cost of sales than was ever purchased drives inventory negative,
    // which is not a state a real ledger can reach.
    const cogs = Math.min(
      Math.round((inventoryBalance * 0.55) / 10_000) * 10_000,
      Math.round((monthNet * 0.35) / 10_000) * 10_000,
    );
    if (cogs > 0) {
      inventoryBalance -= cogs;
      await post(ctx, {
        date: day(month, monthEndDay),
        journal: 'GEN',
        description: 'Cost of goods and services delivered',
        lines: [
          { code: '5100', debit: cogs },
          { code: '1400', credit: cogs },
        ],
      });
    }

    // ── purchases ────────────────────────────────────────────────────────
    const billCount = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < billCount; i += 1) {
      const supplier = pick(ctx.suppliers);
      const net = between(4_000_000, 14_000_000, 50_000);
      const tax = Math.round((net * VAT_RATE) / 100);
      const gross = net + tax;
      const issueDay = Math.min(monthEndDay, 4 + Math.floor(rnd() * 20));
      const issued = day(month, issueDay);
      vatInputPool += tax;

      // Most restock inventory; the rest are consumed as operating costs.
      const toInventory = rnd() < 0.65;
      if (toInventory) inventoryBalance += net;
      await post(ctx, {
        date: issued,
        journal: 'PURCH',
        description: `Bill — ${supplier.name}`,
        lines: [
          { code: toInventory ? '1400' : '5200', debit: net },
          { code: '1450', debit: tax, description: 'Input VAT' },
          { code: '2100', credit: gross, partnerId: supplier.id },
        ],
      });
      await document(ctx, {
        typeCode: 'vendor_bill',
        partnerId: supplier.id,
        issueDate: issued,
        dueDate: new Date(issued.getTime() + 30 * 86_400_000),
        net,
        tax,
        description: toInventory ? 'Stock replenishment' : 'Services and consumables',
        paid: 0,
      });
      openPayables.push({ partnerId: supplier.id, amount: gross });
    }

    // Settle most outstanding supplier balances.
    for (let i = openPayables.length - 1; i >= 0; i -= 1) {
      if (rnd() > 0.75) continue;
      const owed = openPayables.splice(i, 1)[0];
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 8 + Math.floor(rnd() * 18))),
        journal: 'BANK',
        description: 'Supplier payment',
        lines: [
          { code: '2100', debit: owed.amount, partnerId: owed.partnerId },
          { code: '1200', credit: owed.amount },
        ],
      });
    }

    // ── banking of takings ───────────────────────────────────────────────
    // Counter and mobile-money receipts are banked, less a float. Without this
    // the cash accounts balloon while the bank account funds every payment and
    // goes overdrawn — a shape no real set of books would show.
    const sweepCash = Math.floor((cashOnHand * 0.85) / 10_000) * 10_000;
    if (sweepCash > 0) {
      cashOnHand -= sweepCash;
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 22)),
        journal: 'CASH',
        description: 'Banking of cash takings',
        lines: [
          { code: '1200', debit: sweepCash },
          { code: '1100', credit: sweepCash },
        ],
      });
    }
    const sweepMomo = Math.floor((momoOnHand * 0.9) / 10_000) * 10_000;
    if (sweepMomo > 0 && ctx.accounts.has('MOMO-MTN')) {
      momoOnHand -= sweepMomo;
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 23)),
        journal: 'CASH',
        description: 'Mobile money settlement to bank',
        lines: [
          { code: '1200', debit: sweepMomo },
          { code: 'MOMO-MTN', credit: sweepMomo },
        ],
      });
    }

    // ── payroll ──────────────────────────────────────────────────────────
    const gross = 18_000_000 + Math.floor(rnd() * 6) * 250_000;
    const paye = Math.round(gross * 0.15);
    const pension = Math.round(gross * 0.05);
    const netPay = gross - paye - pension;
    await post(ctx, {
      date: day(month, Math.min(monthEndDay, 25)),
      journal: 'GEN',
      description: 'Payroll for the month',
      lines: [
        { code: '5710', debit: gross },
        { code: '2180', credit: netPay, description: 'Net pay payable' },
        { code: '2210', credit: paye, description: 'PAYE withheld' },
        { code: '2220', credit: pension, description: 'Pension contribution' },
      ],
    });
    await post(ctx, {
      date: day(month, Math.min(monthEndDay, 28)),
      journal: 'BANK',
      description: 'Salary disbursement',
      lines: [
        { code: '2180', debit: netPay },
        { code: '1200', credit: netPay },
      ],
    });
    // Statutory deductions are remitted the month after they are withheld, so
    // the payroll liabilities carry one month rather than growing forever.
    if (statutoryDue.paye > 0 || statutoryDue.pension > 0) {
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 14)),
        journal: 'BANK',
        description: 'PAYE and pension remittance',
        lines: [
          { code: '2210', debit: statutoryDue.paye },
          { code: '2220', debit: statutoryDue.pension },
          { code: '1200', credit: statutoryDue.paye + statutoryDue.pension },
        ],
      });
    }
    statutoryDue = { paye, pension };

    // ── running costs ────────────────────────────────────────────────────
    const costs: Array<[string, number, string]> = [
      ['5720', 4_000_000, 'Premises rent'],
      ['5730', between(900_000, 1_900_000), 'Electricity and water'],
      ['5740', between(400_000, 1_600_000), 'Marketing and open day'],
      ['5790', between(500_000, 1_400_000), 'Transport and fuel'],
      ['5750', between(200_000, 1_200_000), 'Repairs and maintenance'],
      ['5780', between(60_000, 220_000, 10_000), 'Bank charges'],
    ];
    if (m % 3 === 0) costs.push(['5760', 2_400_000, 'Insurance premium']);
    if (m % 4 === 1) costs.push(['5770', 3_000_000, 'Audit and legal fees']);

    for (const [code, amount, label] of costs) {
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 6 + Math.floor(rnd() * 18))),
        journal: 'BANK',
        description: label,
        lines: [
          { code, debit: amount },
          { code: '1200', credit: amount },
        ],
      });
    }

    // ── depreciation ─────────────────────────────────────────────────────
    await post(ctx, {
      date: day(month, monthEndDay),
      journal: 'GEN',
      description: 'Monthly depreciation charge',
      lines: [
        { code: '5600', debit: 2_000_000 },
        { code: '1490', credit: 2_000_000 },
      ],
    });

    // ── discounts, other income, bad debt ────────────────────────────────
    if (rnd() < 0.6 && monthNet > 0) {
      const discount = Math.round((monthNet * 0.02) / 10_000) * 10_000;
      const customer = pick(ctx.customers);
      await post(ctx, {
        date: day(month, monthEndDay),
        journal: 'SALES',
        description: 'Sibling and early-payment discounts',
        lines: [
          { code: '4900', debit: discount },
          { code: '1300', credit: discount, partnerId: customer.id },
        ],
      });
    }
    if (rnd() < 0.7) {
      const late = between(150_000, 900_000);
      cashOnHand += late;
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 20)),
        journal: 'CASH',
        description: 'Late payment and library fines',
        lines: [
          { code: '1100', debit: late },
          { code: '4260', credit: late },
        ],
      });
    }
    if (m === Math.floor(MONTHS / 2) && openReceivables.length > 0) {
      const written = openReceivables.shift()!;
      await post(ctx, {
        date: day(month, monthEndDay),
        journal: 'GEN',
        description: 'Bad debt written off',
        lines: [
          { code: '5500', debit: written.amount },
          { code: '1300', credit: written.amount, partnerId: written.partnerId },
        ],
      });
    }

    // ── quarterly VAT remittance ─────────────────────────────────────────
    if (m > 0 && m % 3 === 0 && vatOutputPool > vatInputPool) {
      const payable = vatOutputPool - vatInputPool;
      await post(ctx, {
        date: day(month, Math.min(monthEndDay, 15)),
        journal: 'BANK',
        description: 'Quarterly VAT remittance',
        lines: [
          { code: '2200', debit: vatOutputPool },
          { code: '1450', credit: vatInputPool },
          { code: '1200', credit: payable },
        ],
      });
      vatOutputPool = 0;
      vatInputPool = 0;
    }

    console.log(`  · ${month.toISOString().slice(0, 7)} — ${invoiceCount} invoices, ${billCount} bills`);
  }
}

// ─────────────────────────────── reset ─────────────────────────────────────

/**
 * Remove only what a previous run of THIS script wrote. Application postings
 * carry a different `sourceType` and are never in scope.
 */
async function resetPrevious(organizationId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: { organizationId, sourceType: SOURCE_TYPE },
    select: { id: true },
  });
  if (entries.length) {
    // JournalLine cascades on the entry, so deleting the entries is enough.
    await prisma.journalEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  }
  const documents = await prisma.document.findMany({
    where: { organizationId, sourceType: SOURCE_TYPE },
    select: { id: true },
  });
  if (documents.length) {
    await prisma.document.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } });
  }
  console.log(`  - removed ${entries.length} seeded entries and ${documents.length} seeded documents`);
}

// ─────────────────────────────── main ──────────────────────────────────────

async function main() {
  const org = await resolveOrganization();
  console.log(`📊 Seeding accounting history for "${org.name}" (${org.id})`);
  await prisma.$executeRawUnsafe(`SELECT set_config('app.org_id', $1, false)`, org.id);

  if (RESET) await resetPrevious(org.id);

  const accounts = await ensureAccounts(org.id);
  await ensureControlAccounts(org.id, accounts);
  const journals = await ensureJournals(org.id);
  const vatTaxId = await ensureVatTax(org.id);
  const { customers, suppliers } = await ensurePartners(org.id);
  const docTypes = await resolveDocTypes();
  const currency =
    (await prisma.currency.findFirst({ where: { code: 'UGX' }, select: { id: true } })) ??
    (await prisma.currency.findFirst({ select: { id: true } }));

  const required = ['1100', '1200', '1300', '1400', '1450', '1490', '1600', '2100', '2180', '2200', '2210', '2220', '3200', '4100', '4260', '4900', '5100', '5200', '5500', '5600', '5710'];
  const missing = required.filter((code) => !accounts.has(code));
  if (missing.length) {
    throw new Error(
      `This chart of accounts is missing ${missing.join(', ')}. Start the API once so the chart seeder runs, then re-run.`,
    );
  }

  const ctx: Ctx = {
    organizationId: org.id,
    currencyId: currency?.id ?? null,
    accounts,
    journals,
    docTypes,
    customers,
    suppliers,
    vatTaxId,
    entrySeq: 0,
    docSeq: 0,
  };

  await seedHistory(ctx);

  const [entryCount, lineCount, docCount] = await Promise.all([
    prisma.journalEntry.count({ where: { organizationId: org.id, sourceType: SOURCE_TYPE } }),
    prisma.journalLine.count({ where: { organizationId: org.id, entry: { sourceType: SOURCE_TYPE } } }),
    prisma.document.count({ where: { organizationId: org.id, sourceType: SOURCE_TYPE } }),
  ]);

  const totals = await prisma.journalLine.aggregate({
    where: { organizationId: org.id, entry: { status: { in: ['posted', 'reversed'] } } },
    _sum: { baseDebit: true, baseCredit: true },
  });
  const debit = new Prisma.Decimal(totals._sum.baseDebit ?? 0);
  const credit = new Prisma.Decimal(totals._sum.baseCredit ?? 0);

  console.log(`\n✅ ${entryCount} entries · ${lineCount} lines · ${docCount} documents over ${MONTHS} months`);
  console.log(`   Ledger totals — Dr ${debit.toFixed(2)} / Cr ${credit.toFixed(2)}`);
  console.log(debit.minus(credit).abs().lessThanOrEqualTo(0.0001) ? '   Trial balance foots.' : '   ⚠ TRIAL BALANCE DOES NOT FOOT');
}

main()
  .catch((e) => {
    console.error('❌ seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
