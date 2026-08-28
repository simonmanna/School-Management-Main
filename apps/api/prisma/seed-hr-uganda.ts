/**
 * Uganda payroll statutory seed — PAYE, NSSF and Local Service Tax.
 *
 *   pnpm --filter @erp/api exec tsx prisma/seed-hr-uganda.ts <organizationId>
 *
 * ── READ THIS BEFORE RELYING ON THE NUMBERS ─────────────────────────────────
 * These are the long-standing URA / NSSF rates, but statutory rates change.
 * CONFIRM them against current URA and NSSF guidance before running a real
 * payroll. Everything is keyed by `effectiveFrom`, and the payroll engine picks
 * the table active for the run's period, so a rate change is a NEW row — never
 * an edit of an existing one (that would silently restate past pay runs).
 *
 * ── Conventions the engine depends on ───────────────────────────────────────
 *  • `HrTaxBracket.rate` is a FRACTION (0.3 = 30%). `HrPayrollComponent.rate`
 *    is a PERCENT (30 = 30%). They are genuinely different; see
 *    `computeProgressive()` and `componentAmount()` in hr-payroll.service.ts.
 *  • PAYE brackets are stored ANNUALISED. `calculateRun` multiplies monthly
 *    taxable pay by 12, runs the brackets, then divides back — so the bands
 *    below are the monthly URA bands × 12.
 *  • Taxable pay is gross minus pension and social-security deductions.
 *
 * ── Uganda PAYE, resident individuals (monthly) ─────────────────────────────
 *      0 –   235,000   0%
 *  235,001 –  335,000  10% of the excess over 235,000
 *  335,001 –  410,000  20% of the excess over 335,000  (+ 10,000)
 *  410,001 – 10,000,000 30% of the excess over 410,000 (+ 25,000)
 *  over    10,000,000  an ADDITIONAL 10% on the excess over 10,000,000,
 *                      i.e. a 40% top marginal rate.
 *
 * Expressed as marginal bands (what `computeProgressive` wants), annualised.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTHS = 12;
const m = (monthly: number) => monthly * MONTHS;

/** Marginal PAYE bands, annualised. `to: null` means "and above". */
const PAYE_BANDS: Array<{ from: number; to: number | null; rate: number }> = [
  { from: m(0), to: m(235_000), rate: 0 },
  { from: m(235_000), to: m(335_000), rate: 0.1 },
  { from: m(335_000), to: m(410_000), rate: 0.2 },
  { from: m(410_000), to: m(10_000_000), rate: 0.3 },
  { from: m(10_000_000), to: null, rate: 0.4 },
];

/**
 * Local Service Tax — an ANNUAL charge banded on monthly gross, deducted in
 * four equal instalments over July–October. Stored as config rather than a tax
 * table because it is not a progressive computation on each pay run.
 */
const LST_BANDS = [
  { minMonthly: 100_000, maxMonthly: 200_000, annual: 5_000 },
  { minMonthly: 200_001, maxMonthly: 300_000, annual: 10_000 },
  { minMonthly: 300_001, maxMonthly: 400_000, annual: 20_000 },
  { minMonthly: 400_001, maxMonthly: 500_000, annual: 30_000 },
  { minMonthly: 500_001, maxMonthly: 600_000, annual: 40_000 },
  { minMonthly: 600_001, maxMonthly: 700_000, annual: 60_000 },
  { minMonthly: 700_001, maxMonthly: 800_000, annual: 70_000 },
  { minMonthly: 800_001, maxMonthly: 900_000, annual: 80_000 },
  { minMonthly: 900_001, maxMonthly: 1_000_000, annual: 90_000 },
  { minMonthly: 1_000_001, maxMonthly: null, annual: 100_000 },
];

const EFFECTIVE_FROM = new Date('2024-07-01T00:00:00.000Z');

async function main() {
  const organizationId = process.argv[2];
  if (!organizationId) {
    console.error('Usage: tsx prisma/seed-hr-uganda.ts <organizationId>');
    process.exit(1);
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    console.error(`Organization ${organizationId} not found`);
    process.exit(1);
  }

  // ── PAYE progressive table ────────────────────────────────────────────────
  const existingPaye = await prisma.hrTaxTable.findFirst({
    where: { organizationId, code: 'UG-PAYE', effectiveFrom: EFFECTIVE_FROM },
  });
  if (existingPaye) {
    console.log('UG-PAYE already seeded for this effective date — skipping.');
  } else {
    const table = await prisma.hrTaxTable.create({
      data: {
        organizationId,
        code: 'UG-PAYE',
        name: 'Uganda PAYE (resident individuals)',
        countryCode: 'UG',
        taxType: 'PAYE',
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    for (const b of PAYE_BANDS) {
      await prisma.hrTaxBracket.create({
        data: {
          organizationId,
          taxTableId: table.id,
          fromAmount: b.from,
          toAmount: b.to,
          rate: b.rate,
        },
      });
    }
    console.log(`Seeded UG-PAYE with ${PAYE_BANDS.length} annualised bands.`);
  }

  // ── NSSF: 5% employee, 10% employer ───────────────────────────────────────
  // The employee 5% is what reduces net pay, so it is also a recurring payroll
  // component. The employer 10% is a cost to the school, recorded here as
  // config; it does not reduce anyone's pay.
  const nssf = await prisma.hrStatutoryConfig.findFirst({
    where: { organizationId, code: 'UG-NSSF', effectiveFrom: EFFECTIVE_FROM },
  });
  if (nssf) {
    console.log('UG-NSSF already seeded — skipping.');
  } else {
    await prisma.hrStatutoryConfig.create({
      data: {
        organizationId,
        code: 'UG-NSSF',
        name: 'NSSF (Uganda) — 5% employee / 10% employer',
        configType: 'SOCIAL_SECURITY',
        rate: 0.05,
        employerRate: 0.1,
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    console.log('Seeded UG-NSSF (5% employee / 10% employer).');
  }

  // The deduction the engine actually applies each run. `code` contains "SSF"
  // so `calculateRun` classifies it as social security and excludes it from
  // taxable pay — that classification is by code substring, so do not rename it.
  const nssfComponent = await prisma.hrPayrollComponent.findFirst({
    where: { organizationId, code: 'NSSF-SSF' },
  });
  if (nssfComponent) {
    console.log('NSSF-SSF component already exists — skipping.');
  } else {
    await prisma.hrPayrollComponent.create({
      data: {
        organizationId,
        code: 'NSSF-SSF',
        name: 'NSSF employee contribution (5%)',
        componentType: 'DEDUCTION',
        calcMethod: 'PERCENTAGE',
        // PERCENT here, not a fraction — different convention from tax brackets.
        rate: 5,
        isTaxable: false,
        isRecurring: true,
        isActive: true,
      },
    });
    console.log('Seeded NSSF-SSF employee deduction component (5%).');
  }

  // ── Local Service Tax ─────────────────────────────────────────────────────
  const lst = await prisma.hrStatutoryConfig.findFirst({
    where: { organizationId, code: 'UG-LST', effectiveFrom: EFFECTIVE_FROM },
  });
  if (lst) {
    console.log('UG-LST already seeded — skipping.');
  } else {
    await prisma.hrStatutoryConfig.create({
      data: {
        organizationId,
        code: 'UG-LST',
        name: 'Local Service Tax (Uganda) — annual, deducted Jul–Oct',
        configType: 'LOCAL_TAX',
        rate: 0,
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    console.log('Seeded UG-LST config.');
    console.log(
      'NOTE: LST is an ANNUAL banded charge deducted in four instalments (Jul–Oct).\n' +
        '      The bands are documented in this seed; add per-employee LST as a FIXED\n' +
        '      deduction component for those months once each band is assigned.',
    );
    console.table(LST_BANDS);
  }

  console.log('\nDone. CONFIRM all rates against current URA/NSSF guidance before running live payroll.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
