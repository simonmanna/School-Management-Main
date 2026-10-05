/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 16 — expenses.
 *
 * Where a school's money goes: posho, beans and fresh produce every week of
 * term, firewood and gas, UEDCL and NWSC bills, bus fuel and servicing, exam
 * printing, stationery at the start of term, detergents, the sick bay, staff
 * tea, the MDD festival, licences, radio adverts for next year's intake.
 *
 * Supplier bills are raised by the accounts assistant or bursar, approved by
 * the head teacher (never the raiser) and paid from the Centenary operations
 * account a few days later — so at any date some are still awaiting payment.
 * Small cash items go through petty cash, which the bursar may raise and pay
 * alone below the petty-cash threshold, and petty cash is topped up weekly.
 */
import { ok, log, rng, int, pick } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, schoolDaysIso, weekdays } from './kit';
import type { Books } from './13-accounts';
import type { Roster } from './roster';

const PETTY_CASH_THRESHOLD = 200_000;
const PETTY_FLOAT = 500_000;

const CATEGORIES: Array<{ name: string; account: string; icon: string; description: string }> = [
  { name: 'Food & Provisions', account: '5810', icon: 'utensils', description: 'Posho, beans, rice, sugar, oil, fresh produce, meat and milk for the kitchen.' },
  { name: 'Kitchen Fuel', account: '5815', icon: 'flame', description: 'Firewood, charcoal and LPG for the kitchen.' },
  { name: 'Electricity', account: '5820', icon: 'zap', description: 'UEDCL monthly bills (Yaka top-ups for staff quarters included).' },
  { name: 'Water & Sewerage', account: '5825', icon: 'droplet', description: 'NWSC monthly bills.' },
  { name: 'Bus Fuel', account: '5830', icon: 'fuel', description: 'Diesel and lubricants for the school buses.' },
  { name: 'Vehicle Repairs & Insurance', account: '5835', icon: 'wrench', description: 'Servicing, tyres, repairs and comprehensive insurance for the fleet.' },
  { name: 'Stationery & Teaching Materials', account: '5840', icon: 'pencil', description: 'Exercise books, chalk, markers, manila, charts and printing paper.' },
  { name: 'Printing & Examinations', account: '5845', icon: 'printer', description: 'BOT/MOT/EOT papers, mock examinations and report cards.' },
  { name: 'Repairs & Maintenance', account: '5850', icon: 'hammer', description: 'Buildings, plumbing, electrical works, desks and painting.' },
  { name: 'Cleaning & Sanitation', account: '5855', icon: 'sparkles', description: 'Detergents, fumigation, garbage collection and cesspool emptying.' },
  { name: 'Medical Supplies', account: '5860', icon: 'heart-pulse', description: 'Sick bay drugs and first-aid supplies.' },
  { name: 'Internet & Telephone', account: '5865', icon: 'wifi', description: 'Fibre internet, office lines and staff airtime.' },
  { name: 'Sports & Co-curricular', account: '5870', icon: 'trophy', description: 'Sports kits, MDD costumes, festival and competition fees.' },
  { name: 'Staff Welfare', account: '5875', icon: 'users', description: 'Staff tea, end-of-term parties, training and workshops.' },
  { name: 'Boarding Supplies', account: '5880', icon: 'bed', description: 'Mattresses, beddings, toiletries and dormitory items.' },
  { name: 'Security', account: '5885', icon: 'shield', description: 'CCTV maintenance, alarm monitoring and torches.' },
  { name: 'Licences & Subscriptions', account: '5890', icon: 'file-badge', description: 'KCCA trading licence, UNEB centre fees, software subscriptions.' },
  { name: 'Marketing & Admissions', account: '5893', icon: 'megaphone', description: 'Radio adverts, banners, flyers and the open day.' },
  { name: 'Board & PTA Meetings', account: '5896', icon: 'briefcase', description: 'BOG sitting allowances, PTA AGM and refreshments.' },
];

const SUPPLIERS: Record<string, { name: string; phone: string }> = {
  MAIZE: { name: 'Kisenyi Maize Millers Ltd', phone: '+256772418236' },
  PRODUCE: { name: 'Owino Wholesale Produce Dealers', phone: '+256701552907' },
  FRESH: { name: 'Nakawa Market Fresh Supplies', phone: '+256758330114' },
  MEAT: { name: 'Kalerwe Prime Butchery', phone: '+256782904475' },
  WHOLESALE: { name: 'Kikuubo General Wholesalers Ltd', phone: '+256414250887' },
  MILK: { name: "Kayunga Dairy Farmers' Co-operative", phone: '+256776213590' },
  FIREWOOD: { name: 'Bukoto Firewood & Charcoal Suppliers', phone: '+256704118862' },
  GAS: { name: 'Kampala Gas Refills Ltd', phone: '+256392001455' },
  UEDCL: { name: 'UEDCL – Electricity', phone: '+256800285285' },
  NWSC: { name: 'National Water & Sewerage Corporation', phone: '+256800200977' },
  MTN: { name: 'MTN Uganda – Business Fibre', phone: '+256312120000' },
  FUEL: { name: 'City Oil – Ntinda Service Station', phone: '+256772660418' },
  GARAGE: { name: 'Kawempe Auto Garage & Tyre Centre', phone: '+256701447789' },
  INSURE: { name: 'Pinnacle General Insurance (U) Ltd', phone: '+256414343100' },
  STATIONERY: { name: 'Kampala Stationery Centre', phone: '+256414235566' },
  PRINTERS: { name: 'Nasser Road Printers Ltd', phone: '+256772501193' },
  MOCKS: { name: 'Wakiso Mock Examinations Bureau', phone: '+256752880421' },
  HARDWARE: { name: 'Ntinda Hardware & Builders', phone: '+256704903365' },
  CLEAN: { name: 'CleanPro Hygiene Supplies Ltd', phone: '+256393217744' },
  FUMIGATE: { name: 'Bweyogerere Fumigation Services', phone: '+256781223459' },
  PHARMACY: { name: 'Nsambya Pharmacy & Medical Supplies', phone: '+256772334015' },
  SPORTS: { name: 'Sports Arena Uganda Ltd', phone: '+256414258833' },
  MATTRESS: { name: 'Mukono Mattress Makers', phone: '+256701998512' },
  CCTV: { name: 'SecureVision CCTV Systems', phone: '+256752330981' },
  KCCA: { name: 'Kampala Capital City Authority', phone: '+256800990000' },
  UNEB: { name: 'Uganda National Examinations Board', phone: '+256414286635' },
  EDTECH: { name: 'Edutech Uganda – School Management System', phone: '+256393245000' },
  RADIO: { name: 'Kampala Central FM 98.4', phone: '+256414661984' },
  BANNERS: { name: 'Wandegeya Signs & Branding', phone: '+256772116540' },
  CATER: { name: 'Mama Nalongo Catering Services', phone: '+256704556721' },
};

type ExpenseSpec = {
  date: string;
  title: string;
  category: string;
  supplier?: keyof typeof SUPPLIERS;
  amount: number;
  /** Days after the bill until it is paid; null = still unpaid. */
  payLag: number | null;
  raisedBy?: 'accounts' | 'bursar' | 'kitchen' | 'transport';
  outcome?: 'pay' | 'pending' | 'reject' | 'void';
  method?: string;
  note?: string;
  petty?: boolean;
};

export async function seedExpenses(ctx: Ctx, tl: Timeline, books: Books, roster: Roster): Promise<void> {
  const { prisma, O } = ctx;
  const expenses = ctx.svc('modules/expenses/expenses.service', 'ExpensesService');

  // Petty cash: small cash items do not need a second signature.
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: O } });
  const settings = (org.settings as Record<string, any>) ?? {};
  await prisma.organization.update({
    where: { id: O },
    data: { settings: { ...settings, finance: { ...(settings.finance ?? {}), pettyCashThreshold: PETTY_CASH_THRESHOLD, enforcePayerApproverSod: true } } },
  });

  const categoryId = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.expenseCategory.upsert({
      where: { organizationId_name: { organizationId: O, name: c.name } },
      update: { ledgerAccountId: books.account(c.account), icon: c.icon, description: c.description, isActive: true, deletedAt: null },
      create: { organizationId: O, name: c.name, icon: c.icon, description: c.description, ledgerAccountId: books.account(c.account) },
    });
    categoryId.set(c.name, row.id);
  }
  const supplierId = new Map<string, string>();
  for (const [key, s] of Object.entries(SUPPLIERS)) {
    const row = await prisma.partner.upsert({
      where: { organizationId_code: { organizationId: O, code: `SUP-${key}` } },
      update: { name: s.name, isSupplier: true },
      create: { organizationId: O, code: `SUP-${key}`, name: s.name, phone: s.phone, isSupplier: true, isCompany: true },
    });
    supplierId.set(key, row.id);
  }
  ok(`expenses: ${CATEGORIES.length} categories on their own ledger accounts, ${supplierId.size} suppliers, petty cash ≤ UGX ${PETTY_CASH_THRESHOLD.toLocaleString()}`);

  // ── The year's bills ─────────────────────────────────────────────────────
  const specs: ExpenseSpec[] = [];
  const add = (s: ExpenseSpec) => specs.push(s);
  const termDays = (no: 1 | 2 | 3) => schoolDaysIso(roster.term(no).start, roster.term(no).end);
  const mondays = (no: 1 | 2 | 3) => termDays(no).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);

  for (const no of [1, 2, 3] as const) {
    const weeks = mondays(no);
    weeks.forEach((monday, w) => {
      const r = rng(`food:${no}:${w}`);
      const bags = int(r, 9, 12);
      add({ date: monday, title: `Posho (maize flour) – ${bags} × 50kg bags`, category: 'Food & Provisions', supplier: 'MAIZE', amount: bags * 118_000, payLag: int(r, 3, 9), raisedBy: 'kitchen' });
      const beans = int(r, 3, 4);
      add({ date: monday, title: `Beans (nambale) – ${beans} × 100kg bags`, category: 'Food & Provisions', supplier: 'PRODUCE', amount: beans * 455_000, payLag: int(r, 4, 10), raisedBy: 'kitchen' });
      add({ date: addDaysIso(monday, 1), title: 'Fresh produce – matooke, cabbage, tomatoes, onions, greens', category: 'Food & Provisions', supplier: 'FRESH', amount: int(r, 58, 74) * 10_000, payLag: int(r, 2, 6), raisedBy: 'kitchen' });
      add({ date: addDaysIso(monday, 3), title: `Beef for Friday lunch – ${int(r, 55, 70)}kg`, category: 'Food & Provisions', supplier: 'MEAT', amount: int(r, 77, 98) * 10_000, payLag: int(r, 1, 5), raisedBy: 'kitchen' });
      add({ date: addDaysIso(monday, 2), title: `Fresh milk – ${int(r, 38, 46) * 10} litres (porridge & boarders' tea)`, category: 'Food & Provisions', supplier: 'MILK', amount: int(r, 46, 55) * 10_000, payLag: int(r, 2, 7), raisedBy: 'kitchen' });
      if (w % 3 === 0) {
        add({ date: addDaysIso(monday, 1), title: 'Rice, sugar, cooking oil, salt and tea leaves (monthly order)', category: 'Food & Provisions', supplier: 'WHOLESALE', amount: int(r, 215, 260) * 10_000, payLag: int(r, 5, 12), raisedBy: 'accounts' });
        add({ date: addDaysIso(monday, 2), title: 'Firewood – one lorry (7 tonnes)', category: 'Kitchen Fuel', supplier: 'FIREWOOD', amount: int(r, 135, 150) * 10_000, payLag: int(r, 3, 8), raisedBy: 'kitchen' });
      }
      add({ date: addDaysIso(monday, 4), title: `Diesel for school buses – week ${w + 1}`, category: 'Bus Fuel', supplier: 'FUEL', amount: int(r, 175, 235) * 10_000, payLag: int(r, 0, 4), raisedBy: 'transport' });
      // Petty cash, two or three small items a week.
      const petty = [
        ['Charcoal for porridge boilers – 4 bags', 'Kitchen Fuel', 140_000],
        ['Bread for boarders\' Sunday breakfast', 'Food & Provisions', 96_000],
        ['Photocopying of assignments – Kireka copy centre', 'Stationery & Teaching Materials', 45_000],
        ['Plumbing spares – taps and washers', 'Repairs & Maintenance', 68_000],
        ['First-aid top-up – plasters, spirit, ORS', 'Medical Supplies', 52_000],
        ['Boda boda for staff errand to the bank', 'Staff Welfare', 15_000],
        ['Airtime for school office line', 'Internet & Telephone', 50_000],
        ['Light bulbs and extension cables', 'Repairs & Maintenance', 85_000],
        ['Toilet paper and hand soap – lower primary', 'Cleaning & Sanitation', 74_000],
        ['Padlocks for the store', 'Security', 36_000],
      ] as const;
      for (let k = 0; k < int(r, 2, 3); k += 1) {
        const [title, category, amount] = pick(petty, r);
        add({ date: addDaysIso(monday, int(r, 0, 4)), title, category, amount: amount + int(r, 0, 4) * 1_000, payLag: 0, petty: true, raisedBy: 'bursar' });
      }
    });

    // Start-of-term and termly purchases.
    const start = termDays(no)[0];
    const r = rng(`term:${no}`);
    add({ date: addDaysIso(start, -10), title: `Term ${no} stationery – exercise books, chalk, markers, manila, charts`, category: 'Stationery & Teaching Materials', supplier: 'STATIONERY', amount: int(r, 620, 880) * 10_000, payLag: 14, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 2), title: 'Detergents, Jik, brooms and mops (termly order)', category: 'Cleaning & Sanitation', supplier: 'CLEAN', amount: int(r, 135, 170) * 10_000, payLag: 7, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, -5), title: 'Fumigation of dormitories, kitchen and classrooms', category: 'Cleaning & Sanitation', supplier: 'FUMIGATE', amount: 650_000, payLag: 5, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 5), title: 'Sick bay drugs – antimalarials, paracetamol, antibiotics', category: 'Medical Supplies', supplier: 'PHARMACY', amount: int(r, 110, 160) * 10_000, payLag: 6, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 25), title: `Beginning-of-term examination papers – printing (Term ${no})`, category: 'Printing & Examinations', supplier: 'PRINTERS', amount: int(r, 145, 185) * 10_000, payLag: 10, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 50), title: `Mid-term examination papers – printing (Term ${no})`, category: 'Printing & Examinations', supplier: 'PRINTERS', amount: int(r, 150, 190) * 10_000, payLag: 10, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 75), title: `End-of-term examinations and report cards (Term ${no})`, category: 'Printing & Examinations', supplier: 'PRINTERS', amount: int(r, 240, 290) * 10_000, payLag: 12, raisedBy: 'accounts' });
    add({ date: addDaysIso(start, 40), title: 'Cesspool emptying – pupils\' latrines', category: 'Cleaning & Sanitation', supplier: 'FUMIGATE', amount: 480_000, payLag: 3, raisedBy: 'accounts' });
    add({ date: addDaysIso(roster.term(no).end, -3), title: `End-of-term staff party – Term ${no}`, category: 'Staff Welfare', supplier: 'CATER', amount: int(r, 240, 290) * 10_000, payLag: 1, raisedBy: 'bursar' });
    add({ date: addDaysIso(start, 30), title: 'Board of Governors meeting – sitting allowances & lunch', category: 'Board & PTA Meetings', supplier: 'CATER', amount: 1_650_000, payLag: 2, raisedBy: 'bursar' });
  }

  // Monthly bills, January to December.
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    const r = rng(`month:${mm}`);
    const inTerm = ![1, 12].includes(m);
    const billDay = schoolOrWeekday(`2026-${mm}-${m === 1 ? '12' : '06'}`);
    add({ date: billDay, title: `UEDCL electricity bill – ${monthName(m)} 2026`, category: 'Electricity', supplier: 'UEDCL', amount: (inTerm ? int(r, 280, 360) : int(r, 140, 180)) * 10_000, payLag: 6, raisedBy: 'accounts' });
    add({ date: addDaysIso(billDay, 1), title: `NWSC water bill – ${monthName(m)} 2026`, category: 'Water & Sewerage', supplier: 'NWSC', amount: (inTerm ? int(r, 125, 190) : int(r, 60, 85)) * 10_000, payLag: 7, raisedBy: 'accounts' });
    add({ date: addDaysIso(billDay, 2), title: `MTN Business Fibre 50 Mbps – ${monthName(m)} 2026`, category: 'Internet & Telephone', supplier: 'MTN', amount: 850_000, payLag: 3, raisedBy: 'accounts' });
    add({ date: addDaysIso(billDay, 3), title: `LPG gas – 2 × 45kg cylinders refill (${monthName(m)})`, category: 'Kitchen Fuel', supplier: 'GAS', amount: 760_000, payLag: 2, raisedBy: 'kitchen' });
    add({ date: addDaysIso(billDay, 4), title: `Staff tea and breakfast – ${monthName(m)}`, category: 'Staff Welfare', supplier: 'WHOLESALE', amount: int(r, 72, 95) * 10_000, payLag: 4, raisedBy: 'bursar' });
    add({ date: addDaysIso(billDay, 5), title: `Garbage collection – ${monthName(m)}`, category: 'Cleaning & Sanitation', supplier: 'KCCA', amount: 180_000, payLag: 5, raisedBy: 'accounts' });
    if (m % 2 === 1) {
      const bus = pick(['UBJ 451K (Isuzu NQR)', 'UBH 078T (Isuzu NQR)', 'UBK 902P (Toyota Coaster)', 'UBF 336M (Isuzu Forward)', 'UBL 115D (Toyota HiAce)'], r);
      add({ date: addDaysIso(billDay, 8), title: `Service & brake pads – ${bus}`, category: 'Vehicle Repairs & Insurance', supplier: 'GARAGE', amount: int(r, 65, 135) * 10_000, payLag: 9, raisedBy: 'transport' });
    }
    if (m % 3 === 0) add({ date: addDaysIso(billDay, 10), title: 'CCTV system quarterly maintenance (16 cameras)', category: 'Security', supplier: 'CCTV', amount: 450_000, payLag: 7, raisedBy: 'accounts' });
  }

  // One-offs.
  const oneOffs: ExpenseSpec[] = [
    { date: '2026-01-14', title: 'Comprehensive insurance – 6 school vehicles (2026)', category: 'Vehicle Repairs & Insurance', supplier: 'INSURE', amount: 9_640_000, payLag: 10, raisedBy: 'bursar' },
    { date: '2026-01-16', title: 'Mattresses for new boarders – 12 × 4-inch', category: 'Boarding Supplies', supplier: 'MATTRESS', amount: 1_140_000, payLag: 7, raisedBy: 'accounts' },
    { date: '2026-01-19', title: 'Radio adverts – 2026 admissions campaign (3 weeks)', category: 'Marketing & Admissions', supplier: 'RADIO', amount: 1_800_000, payLag: 5, raisedBy: 'bursar' },
    { date: '2026-01-20', title: 'Admissions banners and flyers', category: 'Marketing & Admissions', supplier: 'BANNERS', amount: 650_000, payLag: 3, raisedBy: 'bursar' },
    { date: '2026-02-09', title: 'KCCA trading licence 2026', category: 'Licences & Subscriptions', supplier: 'KCCA', amount: 450_000, payLag: 2, raisedBy: 'bursar' },
    { date: '2026-02-11', title: 'UNEB PLE centre registration fees – 68 candidates', category: 'Licences & Subscriptions', supplier: 'UNEB', amount: 2_312_000, payLag: 3, raisedBy: 'bursar' },
    { date: '2026-02-12', title: 'School management system – annual licence 2026', category: 'Licences & Subscriptions', supplier: 'EDTECH', amount: 3_600_000, payLag: 14, raisedBy: 'bursar' },
    { date: '2026-02-20', title: 'PTA Annual General Meeting – tents, PA system, refreshments', category: 'Board & PTA Meetings', supplier: 'CATER', amount: 1_150_000, payLag: 3, raisedBy: 'bursar' },
    { date: '2026-03-04', title: 'Sports kits – jerseys, footballs, netballs (inter-house sports)', category: 'Sports & Co-curricular', supplier: 'SPORTS', amount: 2_350_000, payLag: 8, raisedBy: 'accounts' },
    { date: '2026-03-18', title: 'Roof leak repair – P.4 classroom block', category: 'Repairs & Maintenance', supplier: 'HARDWARE', amount: 1_280_000, payLag: 6, raisedBy: 'accounts' },
    { date: '2026-04-08', title: 'New tyres (6) – UBJ 451K', category: 'Vehicle Repairs & Insurance', supplier: 'GARAGE', amount: 3_450_000, payLag: 12, raisedBy: 'transport' },
    { date: '2026-05-25', title: 'Painting of nursery classrooms (holiday works)', category: 'Repairs & Maintenance', supplier: 'HARDWARE', amount: 4_750_000, payLag: 10, raisedBy: 'accounts' },
    { date: '2026-06-10', title: 'P.7 mock examinations – Wakiso Mock Bureau (68 candidates)', category: 'Printing & Examinations', supplier: 'MOCKS', amount: 1_428_000, payLag: 5, raisedBy: 'accounts' },
    { date: '2026-06-17', title: 'Educational trip to Jinja – bus hire top-up & entry fees', category: 'Sports & Co-curricular', supplier: 'SPORTS', amount: 2_150_000, payLag: 1, raisedBy: 'bursar' },
    { date: '2026-07-08', title: 'MDD festival costumes and registration (Wakiso zone)', category: 'Sports & Co-curricular', supplier: 'SPORTS', amount: 1_640_000, payLag: 4, raisedBy: 'accounts' },
    { date: '2026-07-22', title: 'Desk repairs – 40 desks (P.2 & P.3)', category: 'Repairs & Maintenance', supplier: 'HARDWARE', amount: 980_000, payLag: 6, raisedBy: 'accounts' },
    { date: '2026-08-19', title: 'Teacher CPD workshop – competence-based assessment', category: 'Staff Welfare', supplier: 'CATER', amount: 1_250_000, payLag: 2, raisedBy: 'bursar' },
    { date: '2026-08-26', title: 'Dormitory beddings – blankets and bedsheets (40 sets)', category: 'Boarding Supplies', supplier: 'MATTRESS', amount: 1_720_000, payLag: 8, raisedBy: 'accounts' },
    { date: '2026-09-15', title: 'Re-wiring of the computer laboratory', category: 'Repairs & Maintenance', supplier: 'HARDWARE', amount: 2_380_000, payLag: 9, raisedBy: 'accounts' },
    // Still in the approval queue or awaiting payment as of early October.
    { date: '2026-09-29', title: 'P.7 candidates\' seminar – facilitators and lunch', category: 'Printing & Examinations', supplier: 'CATER', amount: 1_350_000, payLag: null, raisedBy: 'accounts', outcome: 'pay' },
    { date: '2026-09-30', title: 'Replacement water pump – kitchen borehole', category: 'Repairs & Maintenance', supplier: 'HARDWARE', amount: 2_950_000, payLag: null, raisedBy: 'accounts', outcome: 'pending', note: 'Quotation from Ntinda Hardware attached; two other quotes higher.' },
    { date: '2026-10-01', title: 'New office photocopier (Kyocera)', category: 'Stationery & Teaching Materials', supplier: 'STATIONERY', amount: 6_800_000, payLag: null, raisedBy: 'bursar', outcome: 'pending', note: 'Current machine is 7 years old and jams daily.' },
    { date: '2026-09-22', title: 'Branded umbrellas for staff', category: 'Staff Welfare', supplier: 'BANNERS', amount: 1_100_000, payLag: null, raisedBy: 'accounts', outcome: 'reject', note: 'Not a priority this term — revisit in the 2027 budget.' },
    { date: '2026-04-15', title: 'Extra printing of report cards', category: 'Printing & Examinations', supplier: 'PRINTERS', amount: 640_000, payLag: null, raisedBy: 'accounts', outcome: 'reject', note: 'Already covered by the end-of-term printing order.' },
    { date: '2026-08-12', title: 'Diesel for school buses – duplicate entry', category: 'Bus Fuel', supplier: 'FUEL', amount: 1_950_000, payLag: null, raisedBy: 'transport', outcome: 'void', note: 'Raised twice from the same City Oil invoice.' },
  ];
  oneOffs.forEach(add);

  // ── Put them on the timeline ─────────────────────────────────────────────
  const findExpense = (s: ExpenseSpec) =>
    prisma.expense.findFirst({
      where: { organizationId: O, title: s.title, expenseDate: eat(s.date, '09:00'), amount: s.amount, deletedAt: null },
    });

  let scheduled = 0;
  for (const s of specs) {
    const date = schoolOrWeekday(s.date);
    s.date = date;
    scheduled += 1;
    if (s.petty) {
      tl.add({
        at: eat(date, '12:00'),
        priority: 32,
        label: `petty ${s.title}`,
        run: async () => {
          if (await findExpense(s)) return;
          await ctx.as('bursar', () =>
            expenses.create({
              title: s.title,
              amount: s.amount,
              categoryId: categoryId.get(s.category),
              expenseDate: eat(date, '09:00').toISOString(),
              paymentType: 'CASH',
              paymentMethod: 'cash',
              accountId: books.account('PETTY'),
              notes: 'Petty cash voucher',
            }),
          );
        },
      });
      continue;
    }
    tl.add({
      at: eat(date, '10:00'),
      priority: 33,
      label: `bill ${s.title}`,
      run: async () => {
        let e = await findExpense(s);
        if (!e) {
          e = await ctx.as(s.raisedBy ?? 'accounts', () =>
            expenses.create({
              title: s.title,
              amount: s.amount,
              categoryId: categoryId.get(s.category),
              expenseDate: eat(date, '09:00').toISOString(),
              supplierId: s.supplier ? supplierId.get(s.supplier) : undefined,
              paymentType: 'CREDIT',
              notes: s.note ?? (s.supplier ? `Invoice from ${SUPPLIERS[s.supplier].name}` : undefined),
            }),
          );
        }
        const outcome = s.outcome ?? 'pay';
        if (e!.status === 'DRAFT' && outcome === 'pay') await ctx.as('head', () => expenses.approve(e!.id, { approvalNotes: 'Approved.' }));
        if (e!.status === 'DRAFT' && outcome === 'reject') await ctx.as('head', () => expenses.reject(e!.id, s.note));
        if (outcome === 'void' && !['VOID', 'CANCELLED'].includes(e!.status)) {
          await ctx.as('bursar', () => expenses.void(e!.id, { voidReason: s.note ?? 'Duplicate' }));
        }
      },
    });
    if ((s.outcome ?? 'pay') === 'pay' && s.payLag !== null) {
      const payDay = schoolOrWeekday(addDaysIso(date, Math.max(1, s.payLag)));
      tl.add({
        at: eat(payDay, '14:00'),
        priority: 34,
        label: `pay ${s.title}`,
        run: async () => {
          const e = await findExpense(s);
          if (!e || e.paymentStatus === 'PAID' || e.status !== 'APPROVED') return;
          const r = rng(`paymethod:${s.title}:${date}`);
          const method = s.supplier && ['UEDCL', 'NWSC', 'MTN', 'KCCA', 'UNEB'].includes(s.supplier) ? 'bank_transfer' : pick(['bank_transfer', 'bank_transfer', 'cheque', 'mobile_money'], r);
          await ctx.as('bursar', () =>
            expenses.pay(e.id, {
              paymentMethod: method,
              accountId: books.account('1200'),
              reference: method === 'cheque' ? `CHQ ${String(int(r, 100_400, 100_999))}` : method === 'mobile_money' ? `MoMo ${String(int(r, 10_000_000, 99_999_999))}` : `EFT ${payDay.replace(/-/g, '')}${int(r, 10, 99)}`,
              paymentDate: eat(payDay, '14:00').toISOString(),
            }),
          );
        },
      });
    }
  }

  // Petty cash topped back up to the float every Monday.
  for (const day of weekdays('2026-01-05', ctx.asOf)) {
    if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) continue;
    const posting = ctx.svc('modules/accounting/posting/posting.service', 'PostingService');
    tl.add({
      at: eat(day, '08:30'),
      priority: 31,
      label: `petty cash top-up ${day}`,
      run: async () => {
        const postingKey = `demo:petty-topup:${day}`;
        if (await prisma.journalEntry.findFirst({ where: { organizationId: O, postingKey } })) return;
        const held = await books.balance('PETTY');
        const top = Math.round((PETTY_FLOAT - held) / 1_000) * 1_000;
        if (top < 100_000) return;
        await ctx.as('bursar', () =>
          posting.post({
            journalCode: 'CASH',
            date: eat(day, '08:30'),
            description: `Petty cash reimbursement – week of ${day}`,
            sourceType: 'petty_cash_topup',
            postingKey,
            lines: [
              { accountId: books.account('PETTY'), debit: String(top), description: 'Petty cash float restored' },
              { accountId: books.account('1200'), credit: String(top), description: 'Cash withdrawn – Centenary' },
            ],
          }),
        );
      },
    });
  }
  log(`expenses: ${scheduled} bills and petty-cash vouchers planned (approve → pay; some pending, rejected, voided)`);
}

function monthName(m: number): string {
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
}

/** Bills are dated on working days. */
function schoolOrWeekday(isoDate: string): string {
  let d = isoDate;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDaysIso(d, 1);
  return d;
}
