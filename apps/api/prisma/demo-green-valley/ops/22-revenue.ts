/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 22 — revenue beyond school fees.
 *
 * A school earns more than tuition. Parents buy uniforms, sweaters and
 * exercise books at the school shop; the hall and the field are hired out at
 * weekends; the buses are hired for a wedding during the holidays; the farm
 * sells matooke and eggs; old newspapers and scrap iron sheets are sold off;
 * a diocese sponsors four pupils and the PTA raises money for the perimeter
 * wall; the bank pays interest on the fixed deposit; application forms are
 * sold during the admissions season.
 *
 * Two shapes of record, because that is how the money actually arrives:
 *   • Other Income receipts — cash or mobile money in hand, posted straight to
 *     the revenue account (the shop, the farm, forms, fines, scrap).
 *   • Sales invoices to an institution that pays later — the church that hires
 *     the hall, the NGO that hires the bus, the bulk uniform order from a
 *     neighbouring school — with receipts against them, two still unpaid and
 *     one reduced by a credit note.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, schoolDaysIso, momoTxnId, ugx } from './kit';
import type { Books } from './13-accounts';
import type { Store } from './20-store';
import type { Roster } from './roster';

/** Revenue accounts this stage adds to the chart. */
const ACCOUNTS: Array<{ code: string; name: string }> = [
  { code: '4211', name: 'Hall & Grounds Hire' },
  { code: '4212', name: 'Bus Hire (External)' },
  { code: '4213', name: 'Donations, Grants & Sponsorships' },
  { code: '4214', name: 'School Farm & Produce Sales' },
  { code: '4215', name: 'Photocopying & Printing Services' },
  { code: '4216', name: 'Scrap & Sundry Sales' },
  { code: '4217', name: 'Library Fines & Lost Book Charges' },
  { code: '4218', name: 'Admission Form Sales' },
  { code: '4219', name: 'Certificates & Records Replacement' },
  { code: '4280', name: 'Bank Interest Received' },
];

type Head = { name: string; icon: string; account: string; description: string };

const HEADS: Head[] = [
  { name: 'School Shop – Uniforms & Requirements', icon: 'shirt', account: '4180', description: 'Uniform sets, sweaters, socks, badges and bags sold at the school shop.' },
  { name: 'School Shop – Scholastic Materials', icon: 'pencil', account: '4180', description: 'Exercise books, pens, pencils, crayons and mathematical sets sold to parents.' },
  { name: 'Hall & Grounds Hire', icon: 'building', account: '4211', description: 'Weekend hire of the school hall and playing field.' },
  { name: 'Bus Hire', icon: 'bus', account: '4212', description: 'Hire of school buses during holidays and at weekends.' },
  { name: 'Donations & Sponsorships', icon: 'heart-handshake', account: '4213', description: 'Parish, old pupils and well-wisher contributions.' },
  { name: 'PTA Development Contributions', icon: 'users', account: '4213', description: 'PTA fundraising for the perimeter wall and the library roof.' },
  { name: 'School Farm Produce', icon: 'sprout', account: '4214', description: 'Matooke, maize, eggs and vegetables sold from the school garden.' },
  { name: 'Photocopying & Printing', icon: 'printer', account: '4215', description: 'Photocopying and typing services to parents and the community.' },
  { name: 'Scrap & Old Materials', icon: 'recycle', account: '4216', description: 'Old newspapers, iron sheets, broken desks and scrap metal sold off.' },
  { name: 'Library Fines & Lost Books', icon: 'book', account: '4217', description: 'Overdue fines and the replacement cost of lost library books.' },
  { name: 'Admission Forms', icon: 'file-text', account: '4218', description: 'Sale of admission and interview forms during the admissions season.' },
  { name: 'Certificates & Testimonials', icon: 'award', account: '4219', description: 'Replacement report cards, testimonials and certificates.' },
  { name: 'Bank Interest Received', icon: 'landmark', account: '4280', description: 'Interest on the Stanbic fixed deposit.' },
];

/** Institutions that are invoiced and pay later. */
const CUSTOMERS: Record<string, { name: string; phone: string; email?: string }> = {
  CHURCH: { name: 'St. Andrew’s Church of Uganda, Kyanja', phone: '+256772440118' },
  NGO: { name: 'Hope for Children Uganda (NGO)', phone: '+256414592330', email: 'admin@hopeforchildren.demo' },
  SACCO: { name: 'Kyanja Traders’ SACCO', phone: '+256701882334' },
  SCHOOL: { name: 'Bright Star Nursery School, Kiwatule', phone: '+256782110945' },
  COUNCIL: { name: 'Nakawa Division Education Office', phone: '+256414223900' },
  CHOIR: { name: 'Kampala Youth Choir Association', phone: '+256752330118' },
  SACCO2: { name: 'Wakiso Teachers’ Co-operative Savings Society', phone: '+256772005413' },
};

type SalesSpec = {
  key: string;
  day: string;
  customer: keyof typeof CUSTOMERS;
  description: string;
  dueDays: number;
  lines: Array<{ description: string; quantity: number; unitPrice: number; account: string }>;
  /** days after the invoice the money comes in; null = still open */
  payLag: number | null;
  /** partial settlement fraction */
  payPart?: number;
  method?: 'bank' | 'cash' | 'mobile_money' | 'cheque';
  creditNote?: { day: string; description: string; amount: number; reason: string };
};

export async function seedRevenue(ctx: Ctx, tl: Timeline, books: Books, store: Store, roster: Roster): Promise<void> {
  const { prisma, O } = ctx;
  const incomeHeads = ctx.svc('modules/income/income-heads.service', 'IncomeHeadsService');
  const income = ctx.svc('modules/income/income.service', 'IncomeService');
  const invoices = ctx.svc('modules/invoicing/invoice/invoice.service', 'InvoiceService');
  const creditNotes = ctx.svc('modules/invoicing/credit-note/credit-note.service', 'CreditNoteService');
  const payments = ctx.svc('modules/invoicing/payment/payment.service', 'PaymentService');

  // ── 1. Revenue accounts and income heads ─────────────────────────────────
  const categories = new Map((await prisma.accountCategory.findMany({ select: { id: true, key: true, normalBalance: true } })).map((c) => [c.key, c]));
  const revenueCat = categories.get('revenue');
  if (!revenueCat) throw new Error('Revenue account category missing');
  const parent = await prisma.account.findFirst({ where: { organizationId: O, code: '4000' } });
  const accountId = new Map<string, string>();
  for (const a of ACCOUNTS) {
    const row = await prisma.account.upsert({
      where: { organizationId_code: { organizationId: O, code: a.code } },
      update: { name: a.name, categoryId: revenueCat.id, parentAccountId: parent?.id ?? null },
      create: {
        organizationId: O,
        code: a.code,
        name: a.name,
        categoryId: revenueCat.id,
        normalBalance: revenueCat.normalBalance,
        parentAccountId: parent?.id ?? null,
        isPostable: true,
        sortOrder: Number(a.code),
      },
    });
    accountId.set(a.code, row.id);
  }
  const account = (code: string): string => accountId.get(code) ?? books.account(code);

  const headId = new Map<string, string>();
  for (const h of HEADS) {
    const existing = await prisma.incomeHead.findFirst({ where: { organizationId: O, name: h.name } });
    const row = existing
      ? await prisma.incomeHead.update({ where: { id: existing.id }, data: { icon: h.icon, description: h.description, ledgerAccountId: account(h.account), isActive: true, deletedAt: null } })
      : await ctx.as('bursar', () => incomeHeads.create({ name: h.name, icon: h.icon, description: h.description, ledgerAccountId: account(h.account) }));
    headId.set(h.name, (row as any).id);
  }
  ok(`revenue: ${ACCOUNTS.length} revenue accounts, ${HEADS.length} income heads`);

  // ── 2. Other income receipts across the year ─────────────────────────────
  type Receipt = { day: string; head: string; name: string; amount: number; method: 'CASH' | 'BANK_TRANSFER' | 'MTN_MOBILE_MONEY' | 'AIRTEL_MONEY' | 'CHEQUE'; account: string; note?: string };
  const receipts: Receipt[] = [];
  const addReceipt = (r: Receipt) => receipts.push(r);

  // The school shop: busiest in the first fortnight of every term.
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    const end = ctx.asOf < term.end ? ctx.asOf : term.end;
    const days = schoolDaysIso(term.start, end);
    for (const [d, day] of days.entries()) {
      const r = rng(`shop:${no}:${day}`);
      const busy = d < 10;
      if (!busy && r() < 0.55) continue;
      const uniforms = busy ? int(r, 3, 9) : int(r, 1, 3);
      const uniformTake = uniforms * pick([42_000, 48_000, 38_000, 32_000, 52_000], r);
      addReceipt({
        day,
        head: 'School Shop – Uniforms & Requirements',
        name: `School shop – uniform sales (${uniforms} item${uniforms === 1 ? '' : 's'})`,
        amount: ugx(uniformTake, 500),
        method: r() < 0.55 ? 'CASH' : r() < 0.8 ? 'MTN_MOBILE_MONEY' : 'AIRTEL_MONEY',
        account: r() < 0.55 ? '1100' : 'MOMO-MTN',
      });
      if (busy || r() < 0.4) {
        const books_ = int(r, 10, 45);
        addReceipt({
          day,
          head: 'School Shop – Scholastic Materials',
          name: `School shop – exercise books, pens and pencils (${books_} items)`,
          amount: ugx(books_ * pick([1_000, 1_500, 2_500, 700], r), 500),
          method: 'CASH',
          account: '1100',
        });
      }
    }
    // Farm produce after the harvest weeks.
    for (const k of [20, 45, 70]) {
      const day = weekday(addDaysIso(term.start, k));
      if (day > ctx.asOf) continue;
      const r = rng(`farm:${no}:${k}`);
      addReceipt({
        day,
        head: 'School Farm Produce',
        name: pick([
          'Sale of matooke from the school garden (12 bunches)',
          'Sale of maize from the school garden (4 bags)',
          'Sale of eggs from the poultry unit (18 trays)',
          'Sale of vegetables – sukuma wiki and nakati',
        ], r),
        amount: ugx(int(r, 18, 46) * 10_000, 1_000),
        method: 'CASH',
        account: '1100',
        note: 'Produce sold to staff and neighbours; recorded by the farm attendant.',
      });
    }
    // Photocopying service, once a fortnight.
    const mondays = days.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
    for (const [w, monday] of mondays.entries()) {
      if (w % 2 === 1) continue;
      const r = rng(`copy:${no}:${w}`);
      addReceipt({
        day: monday,
        head: 'Photocopying & Printing',
        name: `Photocopying and typing services – fortnight ${Math.floor(w / 2) + 1}, Term ${no}`,
        amount: ugx(int(r, 6, 22) * 10_000, 500),
        method: 'CASH',
        account: '1100',
      });
    }
    // Replacement report cards and testimonials.
    for (const k of [12, 55]) {
      const day = weekday(addDaysIso(term.start, k));
      if (day > ctx.asOf) continue;
      const r = rng(`cert:${no}:${k}`);
      addReceipt({
        day,
        head: 'Certificates & Testimonials',
        name: pick(['Replacement report cards (3)', 'Testimonial for a transferring pupil', 'Certified copy of PLE results slip'], r),
        amount: pick([15_000, 20_000, 30_000], r),
        method: 'CASH',
        account: '1100',
      });
    }
  }

  // Admissions season: forms sold from September for the 2027 intake.
  for (const day of schoolDaysIso('2026-09-01', ctx.asOf < '2026-11-30' ? ctx.asOf : '2026-11-30')) {
    const r = rng(`forms:${day}`);
    if (r() < 0.55) continue;
    const forms = int(r, 2, 11);
    addReceipt({
      day,
      head: 'Admission Forms',
      name: `Admission forms sold for the 2027 intake (${forms})`,
      amount: forms * 20_000,
      method: r() < 0.5 ? 'CASH' : 'MTN_MOBILE_MONEY',
      account: r() < 0.5 ? '1100' : 'MOMO-MTN',
    });
  }

  // Donations, PTA drives, scrap, interest, library fines banked.
  const oneOffs: Receipt[] = [
    { day: '2026-01-27', head: 'Donations & Sponsorships', name: 'Kyanja Parish – sponsorship of four pupils (Term 1)', amount: 3_200_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT', note: 'St. Andrew’s Church of Uganda, Kyanja – sponsorship programme.' },
    { day: '2026-02-24', head: 'PTA Development Contributions', name: 'PTA perimeter wall fund – Term 1 collections handed over', amount: 7_450_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-03-13', head: 'Scrap & Old Materials', name: 'Sale of old newspapers and cartons', amount: 320_000, method: 'CASH', account: '1100' },
    { day: '2026-03-31', head: 'Bank Interest Received', name: 'Interest on the Stanbic fixed deposit – Q1 2026', amount: 1_180_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-04-21', head: 'Donations & Sponsorships', name: 'Old pupils’ association – 20 desks for P.3', amount: 2_400_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-05-19', head: 'Donations & Sponsorships', name: 'Kyanja Parish – sponsorship of four pupils (Term 2)', amount: 3_200_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-06-09', head: 'Scrap & Old Materials', name: 'Sale of broken desks and scrap iron sheets', amount: 760_000, method: 'CASH', account: '1100' },
    { day: '2026-06-30', head: 'Bank Interest Received', name: 'Interest on the Stanbic fixed deposit – Q2 2026', amount: 1_240_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-07-14', head: 'PTA Development Contributions', name: 'PTA library roof fund – AGM pledges received', amount: 4_850_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-08-11', head: 'Donations & Sponsorships', name: 'Hope for Children Uganda – bursary top-up for six pupils', amount: 5_400_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-09-15', head: 'Donations & Sponsorships', name: 'Kyanja Parish – sponsorship of four pupils (Term 3)', amount: 3_200_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-09-30', head: 'Bank Interest Received', name: 'Interest on the Stanbic fixed deposit – Q3 2026', amount: 1_310_000, method: 'BANK_TRANSFER', account: 'BANK-DEFAULT' },
    { day: '2026-02-20', head: 'Bus Hire', name: 'Bus hire – Kyanja Parish choir to Namugongo (UBK 902P)', amount: 850_000, method: 'MTN_MOBILE_MONEY', account: 'MOMO-MTN' },
    { day: '2026-04-30', head: 'Bus Hire', name: 'Bus hire – wedding party to Mukono (UBJ 451K, holiday)', amount: 1_200_000, method: 'CASH', account: '1100' },
    { day: '2026-08-07', head: 'Hall & Grounds Hire', name: 'Hall hire – Kyanja village savings group meeting (Saturday)', amount: 300_000, method: 'CASH', account: '1100' },
    { day: '2026-05-23', head: 'Hall & Grounds Hire', name: 'Playing field hire – Kyanja United football tournament', amount: 450_000, method: 'MTN_MOBILE_MONEY', account: 'MOMO-MTN' },
  ];
  for (const o of oneOffs) if (o.day <= ctx.asOf) addReceipt(o);

  // Library fines collected at the end of each term, from what the library billed.
  for (const no of [1, 2] as const) {
    const day = weekday(addDaysIso(roster.term(no).end, -2));
    if (day > ctx.asOf) continue;
    tl.add({
      at: eat(day, '15:00'),
      priority: 75,
      label: `library fines banked T${no}`,
      run: async () => {
        const marker = `demo:income:libfines:T${no}`;
        if (await prisma.income.findFirst({ where: { organizationId: O, description: { contains: marker } } })) return;
        const fined = await prisma.borrowing.aggregate({
          where: { organizationId: O, fineAmount: { gt: 0 }, returnedAt: { lte: eat(day, '15:00') } },
          _sum: { fineAmount: true },
        });
        const total = Math.round(Number(fined._sum.fineAmount ?? 0) * 0.45);
        if (total < 5_000) return;
        await ctx.as('bursar', () =>
          income.create({
            name: `Library overdue fines collected – Term ${no}`,
            description: `Cash fines collected at the library desk · ${marker}`,
            amount: ugx(total, 500),
            incomeDate: eat(day, '15:00').toISOString(),
            incomeHeadId: headId.get('Library Fines & Lost Books'),
            paymentMethod: 'CASH',
            accountId: books.account('1100'),
            receivedById: ctx.users.bursar,
          }),
        );
      },
    });
  }

  for (const [i, r] of receipts.entries()) {
    if (r.day > ctx.asOf) continue;
    tl.add({
      at: eat(r.day, '16:00'),
      priority: 75,
      label: `other income ${r.name}`,
      run: async () => {
        const marker = `demo:income:${r.day}:${i}`;
        if (await prisma.income.findFirst({ where: { organizationId: O, description: { contains: marker } } })) return;
        await ctx.as(r.method === 'CASH' ? 'bursar' : 'accounts', () =>
          income.create({
            name: r.name,
            description: `${r.note ?? ''}${r.note ? ' · ' : ''}${marker}`,
            amount: r.amount,
            incomeDate: eat(r.day, '16:00').toISOString(),
            incomeHeadId: headId.get(r.head),
            paymentMethod: r.method,
            accountId: books.account(r.account),
            invoiceNumber: r.method === 'MTN_MOBILE_MONEY' || r.method === 'AIRTEL_MONEY' ? momoTxnId(rng(`momo:${marker}`), r.method === 'MTN_MOBILE_MONEY' ? 'MTN' : 'AIRTEL') : undefined,
            receivedById: r.method === 'CASH' ? ctx.users.bursar : ctx.users.accounts,
          }),
        );
      },
    });
  }
  log(`other income: ${receipts.length} receipts posted straight to the revenue accounts`);

  // ── 3. Invoices to institutions ──────────────────────────────────────────
  const sales: SalesSpec[] = [
    {
      key: 'hall-church-feb',
      day: '2026-02-14',
      customer: 'CHURCH',
      description: 'Hire of the school hall for the parish confirmation service (Saturday 14 February)',
      dueDays: 14,
      lines: [
        { description: 'School hall hire – full day (08:00–18:00)', quantity: 1, unitPrice: 600_000, account: '4211' },
        { description: 'Plastic chairs – 200 at UGX 1,000', quantity: 200, unitPrice: 1_000, account: '4211' },
        { description: 'Generator and PA system', quantity: 1, unitPrice: 250_000, account: '4211' },
      ],
      payLag: 9,
      method: 'bank',
    },
    {
      key: 'bus-ngo-mar',
      day: '2026-03-20',
      customer: 'NGO',
      description: 'Hire of two school buses for the Hope for Children sports gala, Namboole',
      dueDays: 21,
      lines: [
        { description: 'Bus hire UBJ 451K – Kyanja to Namboole, return', quantity: 1, unitPrice: 950_000, account: '4212' },
        { description: 'Bus hire UBH 078T – Kyanja to Namboole, return', quantity: 1, unitPrice: 950_000, account: '4212' },
        { description: 'Drivers’ allowance and fuel surcharge', quantity: 2, unitPrice: 120_000, account: '4212' },
      ],
      payLag: 17,
      method: 'cheque',
    },
    {
      key: 'uniform-brightstar-apr',
      day: '2026-04-09',
      customer: 'SCHOOL',
      description: 'Bulk uniform order for Bright Star Nursery School (shared tailor arrangement)',
      dueDays: 30,
      lines: [
        { description: 'Nursery uniform sets', quantity: 40, unitPrice: 40_000, account: '4180' },
        { description: 'School socks, pairs', quantity: 80, unitPrice: 6_500, account: '4180' },
      ],
      payLag: 24,
      method: 'bank',
      creditNote: { day: '2026-04-27', description: 'Six nursery uniform sets returned – wrong colour of trim', amount: 240_000, reason: 'Returned goods' },
    },
    {
      key: 'hall-sacco-may',
      day: '2026-05-16',
      customer: 'SACCO',
      description: 'Hire of the school hall for the SACCO annual general meeting',
      dueDays: 14,
      lines: [
        { description: 'School hall hire – half day', quantity: 1, unitPrice: 350_000, account: '4211' },
        { description: 'Chairs and tables', quantity: 1, unitPrice: 120_000, account: '4211' },
      ],
      payLag: 11,
      method: 'mobile_money',
    },
    {
      key: 'field-choir-jun',
      day: '2026-06-20',
      customer: 'CHOIR',
      description: 'Hire of the hall and compound for the inter-church choir competition',
      dueDays: 14,
      lines: [
        { description: 'Hall and compound hire – two days', quantity: 2, unitPrice: 400_000, account: '4211' },
        { description: 'Water, electricity and cleaning', quantity: 1, unitPrice: 150_000, account: '4211' },
      ],
      payLag: 6,
      payPart: 0.6,
      method: 'bank',
    },
    {
      key: 'bus-council-jul',
      day: '2026-07-24',
      customer: 'COUNCIL',
      description: 'Bus hire for the Nakawa Division schools’ music festival (two trips)',
      dueDays: 30,
      lines: [{ description: 'Bus hire UBF 336M – two return trips to Lugogo', quantity: 2, unitPrice: 780_000, account: '4212' }],
      payLag: 28,
      method: 'bank',
    },
    {
      key: 'hall-sacco2-sep',
      day: '2026-09-12',
      customer: 'SACCO2',
      description: 'Hire of the school hall for the teachers’ co-operative members’ meeting',
      dueDays: 14,
      lines: [{ description: 'School hall hire – full day', quantity: 1, unitPrice: 600_000, account: '4211' }],
      payLag: null,
    },
    {
      key: 'uniform-brightstar-sep',
      day: '2026-09-25',
      customer: 'SCHOOL',
      description: 'Second bulk uniform order for Bright Star Nursery School (Term 3)',
      dueDays: 30,
      lines: [
        { description: 'Nursery uniform sets', quantity: 25, unitPrice: 40_000, account: '4180' },
        { description: 'School badges, embroidered', quantity: 60, unitPrice: 3_500, account: '4180' },
      ],
      payLag: null,
    },
    {
      key: 'bus-ngo-oct',
      day: '2026-10-02',
      customer: 'NGO',
      description: 'Bus hire for the Hope for Children end-of-year outreach, Mpigi',
      dueDays: 21,
      lines: [{ description: 'Bus hire UBK 902P – Kyanja to Mpigi, return', quantity: 1, unitPrice: 1_150_000, account: '4212' }],
      payLag: null,
    },
  ];

  const customerId = new Map<string, string>();
  for (const [key, c] of Object.entries(CUSTOMERS)) {
    const row = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: `CUST-${key}` } },
      update: { name: c.name, isCustomer: true, phone: c.phone, email: c.email },
      create: { organizationId: O, code: `CUST-${key}`, name: c.name, phone: c.phone, email: c.email, isCustomer: true, isCompany: true },
    });
    customerId.set(key, row.id);
  }

  const findInvoice = (key: string) => prisma.document.findFirst({ where: { organizationId: O, documentType: 'sales_invoice', reference: `demo:sale:${key}` } });

  for (const s of sales) {
    if (s.day > ctx.asOf) continue;
    tl.add({
      at: eat(s.day, '10:00'),
      priority: 76,
      label: `sales invoice ${s.key}`,
      run: async () => {
        if (await findInvoice(s.key)) return;
        const inv: any = await ctx.as('accounts', () =>
          invoices.create({
            partnerId: customerId.get(s.customer)!,
            issueDate: eat(s.day, '10:00').toISOString(),
            dueDate: eat(addDaysIso(s.day, s.dueDays), '10:00').toISOString(),
            paymentMode: 'credit',
            reference: `demo:sale:${s.key}`,
            notes: s.description,
            lines: s.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: account(l.account) })),
          }),
        );
        await ctx.as('accounts', () => invoices.post(inv.id));
      },
    });

    if (s.creditNote) {
      const cn = s.creditNote;
      if (cn.day <= ctx.asOf) {
        tl.add({
          at: eat(cn.day, '11:00'),
          priority: 77,
          label: `credit note ${s.key}`,
          run: async () => {
            const marker = `demo:cn:${s.key}`;
            if (await prisma.document.findFirst({ where: { organizationId: O, documentType: 'credit_note', reference: marker } })) return;
            const inv = await findInvoice(s.key);
            if (!inv) return;
            const note: any = await ctx.as('accounts', () =>
              creditNotes.create({
                partnerId: customerId.get(s.customer)!,
                issueDate: eat(cn.day, '11:00').toISOString(),
                reference: marker,
                notes: `${cn.reason}: ${cn.description}`,
                reversedDocumentId: inv.id,
                lines: [{ description: cn.description, quantity: 1, unitPrice: cn.amount, accountId: account(s.lines[0].account) }],
              }),
            );
            await ctx.as('head', () => creditNotes.post(note.id, 'restock'));
          },
        });
      }
    }

    if (s.payLag === null) continue;
    const payDay = weekday(addDaysIso(s.day, s.payLag));
    if (payDay > ctx.asOf) continue;
    tl.add({
      at: eat(payDay, '12:00'),
      priority: 78,
      label: `receipt ${s.key}`,
      run: async () => {
        const inv = await findInvoice(s.key);
        if (!inv) return;
        const residual = Number(inv.amountResidual);
        if (residual <= 0) return;
        const amount = ugx(s.payPart ? Math.round(residual * s.payPart) : residual, 1_000);
        if (amount <= 0) return;
        const r = rng(`salespay:${s.key}`);
        const method = s.method ?? 'bank';
        await ctx.as('accounts', () =>
          payments.createReceipt({
            partnerId: customerId.get(s.customer)!,
            paymentDate: eat(payDay, '12:00').toISOString(),
            amount: Math.min(amount, residual),
            paymentMethod: method,
            accountId: books.account(method === 'cash' ? '1100' : method === 'mobile_money' ? 'MOMO-MTN' : 'BANK-DEFAULT'),
            reference:
              method === 'cheque'
                ? `Cheque ${int(r, 400_100, 400_999)} – ${CUSTOMERS[s.customer].name}`
                : method === 'mobile_money'
                  ? `MoMo ${momoTxnId(r, 'MTN')}`
                  : `EFT ${payDay.replace(/-/g, '')}${int(r, 10, 99)}`,
            allocations: [{ documentId: inv.id, amount: Math.min(amount, residual) }],
          }),
        );
      },
    });
  }
  log(`institutional sales: ${sales.length} invoices (${sales.filter((s) => s.payLag === null).length} still open, 1 part paid, 1 credit note)`);
  void store;
}

function weekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, 1);
  return d;
}
