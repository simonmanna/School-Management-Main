/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO DATA — FICTIONAL SCHOOL, FICTIONAL PEOPLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Stage 14 — school fees.
 *
 * The 2026 fee catalogue a Kampala nursery-and-primary school publishes (per
 * class, day and boarding), the one-off charges (development levy, PLE
 * candidate fee, new-pupil requirements), the optional ones (swimming, music,
 * coaching, after-school care, the Term 2 trip), bursaries and sponsored
 * pupils — and then the money: every term billed a week before reporting day,
 * and every family paying the way families do. Most pay by Stanbic deposit or
 * mobile money, some at the bursar's window; most clear the term, some pay in
 * instalments, a few carry a balance into the next term and a handful barely
 * pay at all, which is what the defaulters list is for.
 */
import { ok, log, rng, pick, int } from '../shared';
import type { Ctx, Timeline } from './kit';
import { eat, addDaysIso, momoTxnId } from './kit';
import type { Books } from './13-accounts';
import type { Pupil, Roster } from './roster';
import { NURSERY, PRIMARY } from './roster';

const TUITION: Record<string, number> = {
  BABY: 380_000, MIDDLE: 380_000, TOP: 400_000,
  P1: 480_000, P2: 480_000, P3: 500_000, P4: 520_000, P5: 540_000, P6: 560_000, P7: 600_000,
};
const BOARDING_PRIMARY = 650_000;
const BOARDING_NURSERY = 700_000;
const EXAM: Record<string, number> = { P1: 25_000, P2: 25_000, P3: 25_000, P4: 25_000, P5: 25_000, P6: 25_000, P7: 40_000 };
const MEDICAL = 15_000;

/** Fee category code → fee product (and so the revenue account). */
const PRODUCT_FOR: Record<string, string> = {
  TUITION: 'FEE-TUITION', BOARDING: 'FEE-BOARDING', EXAM: 'FEE-EXAM', MEDICAL: 'FEE-MEDICAL',
  DEVELOPMENT: 'FEE-DEVELOPMENT', PLE: 'FEE-PLE', ADMISSION: 'FEE-ADMISSION', UNIFORM: 'FEE-UNIFORM',
  SWIMMING: 'FEE-SWIMMING', MUSIC: 'FEE-MUSIC', COACHING: 'FEE-COACHING', CARE: 'FEE-CARE', TRIP: 'FEE-TRIP',
};

type Component = { code: string; name: string; amount: number; isOptional?: boolean };
type StructureSpec = {
  name: string;
  applicableTo: { gradeLevelIds?: string[]; residenceTypes?: string[] };
  components: Component[];
  terms: Array<1 | 2 | 3>;
};

const SPONSORS = [
  { code: 'SPN-BFF', name: 'Bright Futures Foundation', pupils: 5, note: 'UK charity; pays by EFT in the second week of term.' },
  { code: 'SPN-KPET', name: 'Kyaliwajjala Parish Education Trust', pupils: 4, note: 'Pays by cheque deposited at Stanbic.' },
  { code: 'SPN-EST', name: 'Equity Scholars Trust', pupils: 3, note: 'Covers tuition and boarding for orphaned pupils.' },
];

const BURSARIES = [
  { code: 'STAFF', name: 'Staff Child Bursary (50%)', percent: 50, count: 10, grades: [...NURSERY, ...PRIMARY], awardedBy: 'Board of Governors' },
  { code: 'MERIT', name: 'Academic Excellence Bursary (30%)', percent: 30, count: 6, grades: ['P5', 'P6', 'P7'], awardedBy: 'Head Teacher' },
  { code: 'TALENT', name: 'Sports & Talent Bursary (25%)', percent: 25, count: 5, grades: ['P4', 'P5', 'P6', 'P7'], awardedBy: 'Head Teacher' },
  { code: 'ORPHAN', name: 'Orphan Support Bursary (40%)', percent: 40, count: 4, grades: PRIMARY, awardedBy: 'Board of Governors' },
];

type PayerProfile = 'prompt' | 'instalments' | 'late' | 'defaulter' | 'sponsored';
type Method = 'bank' | 'mtn' | 'airtel' | 'cash';

export interface FeesHandle {
  sponsoredPupilIds: Set<string>;
  bursaryPupilIds: Set<string>;
  profileOf: (p: Pupil) => PayerProfile;
}

export async function seedFees(ctx: Ctx, tl: Timeline, books: Books, roster: Roster): Promise<FeesHandle> {
  const { prisma, O } = ctx;
  const catalog = ctx.svc('modules/school/fees/catalog.service', 'FeeStructureService');
  const schedules = ctx.svc('modules/school/fees/catalog.service', 'FeeScheduleService');
  const billing = ctx.svc('modules/school/fees/billing.service', 'BillingService');
  const payments = ctx.svc('modules/school/fees/billing.service', 'SchoolPaymentService');
  const advanced = ctx.svc('modules/school/fees/advanced.service', 'AdvancedFinanceService');

  const categories = new Map(
    (await prisma.feeCategory.findMany({ where: { organizationId: O } })).map((c) => [c.code.toUpperCase(), c]),
  );
  const g = (code: string) => roster.gradeLevelId(code);

  // ── 1. The catalogue ─────────────────────────────────────────────────────
  const specs: StructureSpec[] = [];
  for (const grade of NURSERY) {
    const label = grade === 'BABY' ? 'Baby Class' : grade === 'MIDDLE' ? 'Middle Class' : 'Top Class';
    specs.push({
      name: `${label} Fees 2026`,
      applicableTo: { gradeLevelIds: [g(grade)] },
      components: [
        { code: 'TUITION', name: 'Tuition Fees', amount: TUITION[grade] },
        { code: 'MEDICAL', name: 'Medical & Sick Bay', amount: MEDICAL },
      ],
      terms: [1, 2, 3],
    });
  }
  specs.push({
    name: 'Nursery Boarding Fees 2026',
    applicableTo: { gradeLevelIds: NURSERY.map(g), residenceTypes: ['boarding'] },
    components: [{ code: 'BOARDING', name: 'Boarding Fees (meals & accommodation)', amount: BOARDING_NURSERY }],
    terms: [1, 2, 3],
  });
  for (const grade of PRIMARY) {
    const label = `P.${grade.slice(1)}`;
    for (const residence of ['day', 'boarding'] as const) {
      specs.push({
        name: `${label} ${residence === 'day' ? 'Day' : 'Boarding'} Fees 2026`,
        applicableTo: { gradeLevelIds: [g(grade)], residenceTypes: [residence] },
        components: [
          { code: 'TUITION', name: 'Tuition Fees', amount: TUITION[grade] },
          ...(residence === 'boarding'
            ? [{ code: 'BOARDING', name: 'Boarding Fees (meals & accommodation)', amount: BOARDING_PRIMARY }]
            : []),
          { code: 'EXAM', name: grade === 'P7' ? 'Examination Fee (incl. mocks)' : 'Examination Fee', amount: EXAM[grade] },
          { code: 'MEDICAL', name: 'Medical & Sick Bay', amount: MEDICAL },
        ],
        terms: [1, 2, 3],
      });
    }
  }
  specs.push({
    name: 'Development Levy 2026',
    applicableTo: {},
    components: [{ code: 'DEVELOPMENT', name: 'Development Levy (new classroom block)', amount: 50_000 }],
    terms: [1],
  });
  specs.push({
    name: 'P.7 Candidate Fees 2026',
    applicableTo: { gradeLevelIds: [g('P7')] },
    components: [{ code: 'PLE', name: 'PLE Registration & Mock Examinations', amount: 75_000 }],
    terms: [1],
  });
  specs.push({
    name: 'New Pupil Requirements 2026',
    applicableTo: {},
    components: [
      { code: 'ADMISSION', name: 'Admission Fee', amount: 100_000, isOptional: true },
      { code: 'UNIFORM', name: 'School Uniform (2 sets + sweater)', amount: 185_000, isOptional: true },
    ],
    terms: [1, 2, 3],
  });
  specs.push({
    name: 'Co-curricular Options 2026',
    applicableTo: {},
    components: [
      { code: 'SWIMMING', name: 'Swimming Lessons', amount: 60_000, isOptional: true },
      { code: 'MUSIC', name: 'Music & Instrument Lessons', amount: 80_000, isOptional: true },
      { code: 'COACHING', name: 'Extra Coaching (Saturdays)', amount: 50_000, isOptional: true },
      { code: 'CARE', name: 'After-school Care (to 6:30pm)', amount: 100_000, isOptional: true },
    ],
    terms: [1, 2, 3],
  });
  specs.push({
    name: 'Term 2 Educational Trip 2026',
    applicableTo: { gradeLevelIds: ['P4', 'P5', 'P6', 'P7'].map(g) },
    components: [{ code: 'TRIP', name: 'Educational Trip – Source of the Nile, Jinja', amount: 45_000, isOptional: true }],
    terms: [2],
  });

  // Anything else on this year is left over from setup and testing. Retire it
  // so the billing run sees only this catalogue — unless it has billed someone.
  const ours = new Set(specs.map((s) => s.name));
  const legacy = await prisma.feeStructure.findMany({
    where: { organizationId: O, academicYearId: roster.yearId, name: { notIn: [...ours] } },
    include: { schedules: true },
  });
  let retired = 0;
  for (const fs of legacy) {
    const billed = await prisma.document.count({
      where: { organizationId: O, sourceType: 'school_fee', sourceId: { in: fs.schedules.map((s) => s.id) } },
    });
    if (billed > 0) continue;
    await prisma.feeSchedule.deleteMany({ where: { feeStructureId: fs.id } });
    const versions = await prisma.feeStructureVersion.findMany({ where: { feeStructureId: fs.id }, select: { id: true } });
    await prisma.feeItem.deleteMany({ where: { feeStructureVersionId: { in: versions.map((v) => v.id) } } });
    await prisma.feeStructureVersion.deleteMany({ where: { feeStructureId: fs.id } });
    await prisma.studentFeeAssignment.deleteMany({ where: { feeStructureId: fs.id } });
    await prisma.feeStructure.delete({ where: { id: fs.id } });
    retired += 1;
  }
  await prisma.discount.updateMany({ where: { organizationId: O }, data: { isActive: false } });

  let created = 0;
  await ctx.as('bursar', async () => {
    for (const spec of specs) {
      let fs = await prisma.feeStructure.findFirst({
        where: { organizationId: O, name: spec.name, academicYearId: roster.yearId },
      });
      if (!fs) {
        fs = await catalog.create({
          name: spec.name,
          academicYearId: roster.yearId,
          applicableTo: spec.applicableTo,
          components: spec.components.map((c) => ({
            code: c.code,
            name: c.name,
            amount: c.amount,
            productId: books.productId(PRODUCT_FOR[c.code]),
            feeCategoryId: categories.get(c.code)?.id,
            ...(c.isOptional !== undefined ? { isOptional: c.isOptional } : {}),
          })),
        });
        created += 1;
      }
      if (!fs!.currentVersionId || fs!.status !== 'published') await catalog.publish(fs!.id);
      for (const no of spec.terms) {
        const term = roster.term(no);
        const exists = await prisma.feeSchedule.findFirst({ where: { organizationId: O, feeStructureId: fs!.id, termId: term.id } });
        if (!exists) {
          await schedules.create({ feeStructureId: fs!.id, termId: term.id, dueDate: addDaysIso(term.start, 14) });
        }
      }
    }
  });
  ok(`fee catalogue: ${specs.length} structures (${created} new, ${retired} legacy retired), scheduled per term`);

  // ── 2. Opt-ins for the optional fees ─────────────────────────────────────
  const optIns: Array<{ pupil: Pupil; term: 1 | 2 | 3; code: string }> = [];
  for (const p of roster.pupils) {
    const r = rng(`optin:${p.id}`);
    const swims = PRIMARY.includes(p.grade) && r() < 0.18;
    const music = !NURSERY.includes(p.grade) && p.grade !== 'P1' && r() < 0.1;
    const coaching = ['P6', 'P7'].includes(p.grade) && r() < 0.55;
    const care = p.residence === 'day' && [...NURSERY, 'P1', 'P2', 'P3'].includes(p.grade) && r() < 0.12;
    const trip = ['P4', 'P5', 'P6', 'P7'].includes(p.grade) && r() < 0.7;
    for (const no of [1, 2, 3] as const) {
      if (swims) optIns.push({ pupil: p, term: no, code: 'SWIMMING' });
      if (music) optIns.push({ pupil: p, term: no, code: 'MUSIC' });
      if (coaching) optIns.push({ pupil: p, term: no, code: 'COACHING' });
      if (care) optIns.push({ pupil: p, term: no, code: 'CARE' });
    }
    if (trip) optIns.push({ pupil: p, term: 2, code: 'TRIP' });
    if (p.isNew) {
      optIns.push({ pupil: p, term: 1, code: 'ADMISSION' });
      optIns.push({ pupil: p, term: 1, code: 'UNIFORM' });
    }
  }
  for (const o of optIns) {
    const feeCategoryId = categories.get(o.code)!.id;
    const termId = roster.term(o.term).id;
    await prisma.studentOptionalFee.upsert({
      where: {
        organizationId_studentProfileId_termId_feeCategoryId: {
          organizationId: O, studentProfileId: o.pupil.id, termId, feeCategoryId,
        },
      },
      update: { isActive: true },
      create: { organizationId: O, studentProfileId: o.pupil.id, termId, feeCategoryId, createdBy: ctx.users.bursar },
    });
  }
  log(`optional fees: ${optIns.length} term opt-ins (swimming, music, coaching, care, trip, new-pupil pack)`);

  // ── 3. Bursaries ─────────────────────────────────────────────────────────
  const taken = new Set<string>();
  const bursaryPupilIds = new Set<string>();
  for (const b of BURSARIES) {
    const pool = roster.pupils.filter((p) => b.grades.includes(p.grade) && !taken.has(p.id));
    const r = rng(`bursary:${b.code}`);
    for (let i = 0; i < b.count && pool.length > 0; i += 1) {
      const p = pool.splice(Math.floor(r() * pool.length), 1)[0];
      taken.add(p.id);
      bursaryPupilIds.add(p.id);
      const code = `BUR-${b.code}-${p.admissionNo.replace(/\W/g, '')}`;
      const exists = await prisma.scholarship.findFirst({ where: { organizationId: O, studentProfileId: p.id, code } });
      if (!exists) {
        await prisma.scholarship.create({
          data: {
            organizationId: O,
            studentProfileId: p.id,
            code,
            name: b.name,
            type: 'percent',
            value: b.percent,
            validFrom: new Date('2026-01-01T00:00:00+03:00'),
            validTo: new Date('2026-12-31T23:59:59+03:00'),
            awardedBy: b.awardedBy,
            notes: `Awarded for the 2026 school year. Reviewed each December.`,
          },
        });
      }
    }
  }
  log(`bursaries: ${bursaryPupilIds.size} pupils (staff children, merit, talent, orphan support)`);

  // ── 4. Sponsors ──────────────────────────────────────────────────────────
  const sponsoredPupilIds = new Set<string>();
  const sponsorOf = new Map<string, { name: string; code: string }>();
  await ctx.as('bursar', async () => {
    for (const s of SPONSORS) {
      const partner = await prisma.partner.upsert({
        where: { organizationId_code: { organizationId: O, code: s.code } },
        update: { name: s.name },
        create: { organizationId: O, code: s.code, name: s.name, isCustomer: true, isCompany: true, notes: s.note },
      });
      const pool = roster.pupils.filter((p) => !taken.has(p.id) && PRIMARY.includes(p.grade));
      const r = rng(`sponsor:${s.code}`);
      for (let i = 0; i < s.pupils && pool.length > 0; i += 1) {
        const p = pool.splice(Math.floor(r() * pool.length), 1)[0];
        taken.add(p.id);
        sponsoredPupilIds.add(p.id);
        sponsorOf.set(p.id, { name: s.name, code: s.code });
        const code = `${s.code}-${p.admissionNo.replace(/\W/g, '')}`;
        const exists = await prisma.sponsorship.findFirst({ where: { organizationId: O, code } });
        if (!exists) {
          await advanced.createSponsorship({
            sponsorId: partner.id,
            studentProfileId: p.id,
            code,
            name: `${s.name} – ${p.name}`,
            validFrom: '2026-01-01T00:00:00+03:00',
            validTo: '2026-12-31T23:59:59+03:00',
            notes: s.note,
          });
        }
      }
    }
  });
  log(`sponsors: ${SPONSORS.length} organisations sponsoring ${sponsoredPupilIds.size} pupils`);

  // ── 4b. The Board's collection targets, per term ─────────────────────────
  const BUDGET: Array<{ category: string; name: string; perTerm: number; terms?: Array<1 | 2 | 3> }> = [
    { category: 'All fees', name: 'Total fee collections', perTerm: 610_000_000 },
    { category: 'Tuition', name: 'Tuition collections', perTerm: 335_000_000 },
    { category: 'Boarding', name: 'Boarding collections', perTerm: 66_000_000 },
    { category: 'Transport', name: 'Transport collections', perTerm: 46_000_000 },
    { category: 'Meals', name: 'Meals plan collections', perTerm: 96_000_000 },
    { category: 'Examination', name: 'Examination fee collections', perTerm: 18_000_000 },
    { category: 'Development', name: 'Development levy collections', perTerm: 33_000_000, terms: [1] },
  ];
  for (const b of BUDGET) {
    for (const no of b.terms ?? ([1, 2, 3] as const)) {
      const term = roster.term(no);
      const name = `${b.name} – ${term.name} 2026`;
      const exists = await prisma.budget.findFirst({ where: { organizationId: O, name } });
      if (!exists) {
        await prisma.budget.create({
          data: { organizationId: O, academicYearId: roster.yearId, termId: term.id, category: b.category, name, amount: b.perTerm, currency: 'UGX', status: 'approved', notes: 'Approved by the Board of Governors, December 2025.' },
        });
      }
    }
  }

  // ── 5. Billing: a week before each reporting day ─────────────────────────
  const BILL_DAY: Record<1 | 2 | 3, string> = { 1: '2026-01-23', 2: '2026-05-08', 3: '2026-08-24' };
  const gradesWithPupils = [...new Set(roster.pupils.map((p) => p.grade))];
  for (const no of [1, 2, 3] as const) {
    const term = roster.term(no);
    for (const grade of gradesWithPupils) {
      const classId = roster.classIdByGrade(grade);
      tl.add({
        at: eat(BILL_DAY[no], '09:00'),
        priority: 10,
        label: `bill ${term.name} ${grade}`,
        run: () => ctx.as('bursar', () => billing.generateForTerm({ termId: term.id, classId })),
      });
    }
  }

  // ── 6. Receipts ──────────────────────────────────────────────────────────
  const profileOf = (p: Pupil): PayerProfile => {
    if (sponsoredPupilIds.has(p.id)) return 'sponsored';
    const x = rng(`payer:${p.id}`)();
    return x < 0.42 ? 'prompt' : x < 0.77 ? 'instalments' : x < 0.93 ? 'late' : 'defaulter';
  };
  const methodOf = (p: Pupil): Method => {
    const x = rng(`method:${p.partnerId}`)();
    return x < 0.5 ? 'bank' : x < 0.78 ? 'mtn' : x < 0.88 ? 'airtel' : 'cash';
  };

  const termReferences = (termId: string) => [`TERM-${termId}`, `MEALS-${termId}`, `TRANSPORT-${termId}`];
  const termTotal = async (p: Pupil, termId: string): Promise<number> => {
    const agg = await prisma.document.aggregate({
      where: { organizationId: O, partnerId: p.partnerId, reference: { in: termReferences(termId) }, status: 'posted' },
      _sum: { totalAmount: true },
    });
    return Number(agg._sum.totalAmount ?? 0);
  };
  const outstanding = async (p: Pupil): Promise<number> => {
    const agg = await prisma.document.aggregate({
      where: { organizationId: O, partnerId: p.partnerId, status: 'posted', amountResidual: { gt: 0 } },
      _sum: { amountResidual: true },
    });
    return Number(agg._sum.amountResidual ?? 0);
  };

  type Instalment = { day: number; share: number | 'all'; overpay?: boolean };
  const planFor = (p: Pupil, no: 1 | 2 | 3): Instalment[] => {
    const r = rng(`plan:${p.id}:${no}`);
    switch (profileOf(p)) {
      case 'sponsored':
        return [{ day: int(r, 7, 13), share: 'all' }];
      case 'prompt': {
        if (r() < 0.25) return [{ day: int(r, -6, 4), share: 0.6 }, { day: int(r, 18, 34), share: 'all' }];
        return [{ day: int(r, -6, 9), share: 'all', overpay: r() < 0.12 }];
      }
      case 'instalments': {
        const parts = r() < 0.5 ? 3 : 4;
        const plan: Instalment[] = [{ day: int(r, -3, 7), share: 0.4 }, { day: int(r, 21, 35), share: 0.3 }];
        if (parts === 4) plan.push({ day: int(r, 42, 55), share: 0.15 });
        plan.push({ day: int(r, 58, 78), share: 'all' });
        return plan;
      }
      case 'late':
        return [
          { day: int(r, 8, 24), share: 0.35 },
          { day: int(r, 38, 58), share: 0.25 },
          ...(r() < 0.6 ? [{ day: int(r, 66, 84), share: 0.15 } as Instalment] : []),
        ];
      case 'defaulter':
        return r() < 0.3 ? [] : [{ day: int(r, 20, 40), share: 0.2 }, ...(r() < 0.5 ? [{ day: int(r, 60, 80), share: 0.12 } as Instalment] : [])];
    }
  };

  let planned = 0;
  let cashBook = 0;
  for (const p of roster.pupils) {
    for (const no of [1, 2, 3] as const) {
      const term = roster.term(no);
      planFor(p, no).forEach((inst, k) => {
        const day = addDaysIso(term.start, inst.day);
        const r = rng(`pay:${p.id}:${no}:${k}`);
        const sponsor = sponsorOf.get(p.id);
        const method: Method = sponsor ? 'bank' : k > 0 && r() < 0.2 ? pick(['bank', 'mtn', 'cash'] as const, r) : methodOf(p);
        const hhmm = `${String(int(r, 8, 16)).padStart(2, '0')}:${String(int(r, 0, 59)).padStart(2, '0')}`;
        const at = eat(weekdayOnOrAfter(day), hhmm);
        const ext = externalRef(method, r, at, () => (cashBook += 1));
        planned += 1;
        tl.add({
          at,
          priority: 20,
          label: `receipt ${p.admissionNo} T${no}#${k + 1}`,
          run: async () => {
            const due = await outstanding(p);
            if (due <= 0) return;
            let amount: number;
            if (inst.share === 'all') {
              amount = inst.overpay ? Math.ceil((due + 1) / 50_000) * 50_000 : due;
            } else {
              const total = await termTotal(p, term.id);
              amount = Math.min(due, Math.ceil((total * inst.share) / 10_000) * 10_000);
            }
            if (amount < 10_000) return;
            await ctx.as(method === 'mtn' || method === 'airtel' ? 'accounts' : 'bursar', () =>
              payments.collect(
                {
                  studentProfileId: p.id,
                  amount,
                  paymentMethod: method === 'bank' ? 'bank' : method === 'cash' ? 'cash' : 'mobile_money',
                  paymentDate: at.toISOString(),
                  reference: narration(method, p, sponsor?.name, no),
                  externalReference: ext.value,
                  externalReferenceType: ext.type,
                  convertOverpaymentToCredit: true,
                },
                { settlementAccountId: books.account(SETTLEMENT[method]) },
              ),
            );
          },
        });
      });
    }
  }
  log(`receipts: ${planned} planned across the year (bank, MTN, Airtel, cash)`);

  // ── 7. Waivers: hardship cases the head approves ─────────────────────────
  const waiverCases = [
    { term: 2 as const, day: 30, amount: 250_000, name: 'Bereavement waiver', reason: 'Father passed away in June; Board approved half of the Term 2 balance.', outcome: 'apply' },
    { term: 2 as const, day: 44, amount: 150_000, name: 'Hardship waiver', reason: 'Family displaced by the Kasokoso evictions; partial waiver on Term 2 fees.', outcome: 'apply' },
    { term: 3 as const, day: 12, amount: 200_000, name: 'Medical hardship waiver', reason: 'Prolonged hospitalisation of the pupil in August.', outcome: 'apply' },
    { term: 3 as const, day: 20, amount: 120_000, name: 'Hardship waiver', reason: 'Guardian lost employment; waiver of meals charge requested.', outcome: 'pending' },
    { term: 3 as const, day: 16, amount: 300_000, name: 'Fee waiver request', reason: 'Requested full waiver of transport fees — not supported by the welfare committee.', outcome: 'reject' },
  ];
  const latePayers = roster.pupils.filter((p) => ['late', 'defaulter'].includes(profileOf(p)) && !bursaryPupilIds.has(p.id));
  waiverCases.forEach((w, i) => {
    const p = latePayers[Math.floor(rng(`waiver:${i}`)() * latePayers.length)];
    if (!p) return;
    const term = roster.term(w.term);
    const at = eat(weekdayOnOrAfter(addDaysIso(term.start, w.day)), '11:00');
    const code = `WVR-2026-${String(i + 1).padStart(3, '0')}`;
    tl.add({
      at,
      priority: 25,
      label: `waiver ${code}`,
      run: async () => {
        let waiver = await prisma.waiver.findFirst({ where: { organizationId: O, code } });
        if (!waiver) {
          waiver = await ctx.as('bursar', () =>
            advanced.createWaiver({ studentProfileId: p.id, code, name: w.name, amount: w.amount, reason: w.reason }),
          );
        }
        if (waiver!.status === 'pending' && w.outcome === 'apply') {
          await ctx.as('head', () => advanced.approveWaiver(waiver!.id));
          await ctx.as('bursar', () => advanced.applyWaiver(waiver!.id));
        } else if (waiver!.status === 'pending' && w.outcome === 'reject') {
          await ctx.as('head', () => advanced.rejectWaiver(waiver!.id, 'Not supported by the welfare committee; parent advised to pay in instalments.'));
        } else if (waiver!.status === 'approved' && !waiver!.applied) {
          await ctx.as('bursar', () => advanced.applyWaiver(waiver!.id));
        }
      },
    });
  });

  return { sponsoredPupilIds, bursaryPupilIds, profileOf };
}

const SETTLEMENT: Record<Method, string> = { bank: 'BANK-DEFAULT', mtn: 'MOMO-MTN', airtel: 'MOMO-AIRTEL', cash: '1100' };

function narration(method: Method, p: Pupil, sponsor: string | undefined, term: number): string {
  if (sponsor) return `${sponsor} – Term ${term} sponsorship (EFT)`;
  switch (method) {
    case 'bank':
      return `Stanbic deposit – ${p.guardianName}`;
    case 'mtn':
      return `MTN MoMo ${p.guardianPhone ?? ''} – ${p.guardianName}`.replace('  ', ' ');
    case 'airtel':
      return `Airtel Money ${p.guardianPhone ?? ''} – ${p.guardianName}`.replace('  ', ' ');
    case 'cash':
      return `Cash at the bursary – ${p.guardianName}`;
  }
}

function externalRef(
  method: Method,
  r: () => number,
  at: Date,
  nextCashNo: () => number,
): { value: string; type: 'bank_txn' | 'mobile_money_txn' | 'import_row' } {
  const ymd = at.toISOString().slice(2, 10).replace(/-/g, '');
  switch (method) {
    case 'bank':
      return { value: `STB${ymd}${String(Math.floor(r() * 1e6)).padStart(6, '0')}`, type: 'bank_txn' };
    case 'mtn':
      return { value: momoTxnId(r, 'MTN'), type: 'mobile_money_txn' };
    case 'airtel':
      return { value: momoTxnId(r, 'AIRTEL'), type: 'mobile_money_txn' };
    case 'cash':
      return { value: `RCB-${ymd}-${String(nextCashNo()).padStart(4, '0')}`, type: 'import_row' };
  }
}

/** Families do not pay at the bank on Sundays. */
function weekdayOnOrAfter(isoDate: string): string {
  let d = isoDate;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDaysIso(d, 1);
  return d;
}
