/**
 * Uganda payroll statutory seed — PAYE, NSSF and Local Service Tax.
 *
 *   pnpm --filter @erp/api exec tsx prisma/seed-hr-uganda.ts <organizationId>
 *
 * ── READ THIS BEFORE RELYING ON THE NUMBERS ─────────────────────────────────
 * These are the long-standing URA / NSSF / LST rates, but statutory rates
 * change. CONFIRM them against current URA, NSSF and local-government guidance
 * before running a real payroll. Everything is keyed by `effectiveFrom`, and
 * the payroll engine picks the version active for the run's period, so a rate
 * change is a NEW row — never an edit of an existing one (that would silently
 * restate past pay runs).
 *
 * ── Conventions the engine depends on ───────────────────────────────────────
 *  • `HrTaxBracket.rate` and `HrStatutoryConfig.rate/employerRate` are
 *    FRACTIONS (0.3 = 30%). `HrPayrollComponent.rate` is a PERCENT (30 = 30%).
 *  • PAYE brackets are stored ANNUALISED. `calculateRun` annualises the
 *    period's taxable pay (×12 monthly, ×52 weekly), runs the brackets, then
 *    divides back — so the bands below are the monthly URA bands × 12.
 *  • Uganda does NOT allow the employee's NSSF contribution as a deduction for
 *    PAYE, so the PAYE table has `contributionsDeductible: false` and
 *    chargeable income is the full taxable gross.
 *  • NSSF (5% employee / 10% employer, on gross) is a statutory CONFIG, not a
 *    payroll component — the engine computes both shares from it, posts the
 *    employer share as a cost, and refuses a duplicate NSSF component.
 *  • LST is a LOCAL tax table: bands on MONTHLY gross, each carrying a fixed
 *    ANNUAL charge collected in equal instalments in July–October.
 *
 * ── Uganda PAYE, resident individuals (monthly) ─────────────────────────────
 *      0 –   235,000   0%
 *  235,001 –  335,000  10% of the excess over 235,000
 *  335,001 –  410,000  20% of the excess over 335,000  (+ 10,000)
 *  410,001 – 10,000,000 30% of the excess over 410,000 (+ 25,000)
 *  over    10,000,000  an ADDITIONAL 10% on the excess over 10,000,000,
 *                      i.e. a 40% top marginal rate.
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
 * Local Service Tax — an ANNUAL charge banded on MONTHLY gross. Bands are
 * contiguous (a boundary value falls in the lower band); income under 100,000
 * pays nothing.
 */
const LST_BANDS: Array<{ from: number; to: number | null; annual: number }> = [
  { from: 100_000, to: 200_000, annual: 5_000 },
  { from: 200_000, to: 300_000, annual: 10_000 },
  { from: 300_000, to: 400_000, annual: 20_000 },
  { from: 400_000, to: 500_000, annual: 30_000 },
  { from: 500_000, to: 600_000, annual: 40_000 },
  { from: 600_000, to: 700_000, annual: 60_000 },
  { from: 700_000, to: 800_000, annual: 70_000 },
  { from: 800_000, to: 900_000, annual: 80_000 },
  { from: 900_000, to: 1_000_000, annual: 90_000 },
  { from: 1_000_000, to: null, annual: 100_000 },
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
    if (existingPaye.contributionsDeductible) {
      await prisma.hrTaxTable.update({ where: { id: existingPaye.id }, data: { contributionsDeductible: false } });
      console.log('UG-PAYE: NSSF is not PAYE-deductible in Uganda — contributionsDeductible set to false.');
    } else {
      console.log('UG-PAYE already seeded for this effective date — skipping.');
    }
  } else {
    const table = await prisma.hrTaxTable.create({
      data: {
        organizationId,
        code: 'UG-PAYE',
        name: 'Uganda PAYE (resident individuals)',
        countryCode: 'UG',
        taxType: 'PAYE',
        effectiveFrom: EFFECTIVE_FROM,
        contributionsDeductible: false,
        isActive: true,
      },
    });
    await prisma.hrTaxBracket.createMany({
      data: PAYE_BANDS.map((b) => ({
        organizationId,
        taxTableId: table.id,
        fromAmount: b.from,
        toAmount: b.to,
        rate: b.rate,
      })),
    });
    console.log(`Seeded UG-PAYE with ${PAYE_BANDS.length} annualised bands.`);
  }

  // ── NSSF: 5% employee, 10% employer, on gross ─────────────────────────────
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
        contributionBase: 'GROSS',
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
      },
    });
    console.log('Seeded UG-NSSF (5% employee / 10% employer).');
  }

  // Older seeds also created an NSSF-SSF deduction COMPONENT. With the
  // statutory config driving NSSF, keeping it would deduct NSSF twice — the
  // engine refuses to calculate while both are active.
  const legacyComponent = await prisma.hrPayrollComponent.updateMany({
    where: { organizationId, code: 'NSSF-SSF', isActive: true },
    data: { isActive: false },
  });
  if (legacyComponent.count > 0) console.log('Deactivated legacy NSSF-SSF component (now driven by UG-NSSF config).');

  // ── Local Service Tax ─────────────────────────────────────────────────────
  const lst = await prisma.hrTaxTable.findFirst({
    where: { organizationId, code: 'UG-LST' },
  });
  if (lst) {
    console.log('UG-LST already seeded — skipping.');
  } else {
    const table = await prisma.hrTaxTable.create({
      data: {
        organizationId,
        code: 'UG-LST',
        name: 'Local Service Tax (Uganda)',
        countryCode: 'UG',
        taxType: 'LOCAL',
        effectiveFrom: EFFECTIVE_FROM,
        collectionMonths: '7,8,9,10',
        // CONFIRM with URA: set true if LST paid is allowed against PAYE.
        contributionsDeductible: false,
        isActive: true,
      },
    });
    await prisma.hrTaxBracket.createMany({
      data: LST_BANDS.map((b) => ({
        organizationId,
        taxTableId: table.id,
        fromAmount: b.from,
        toAmount: b.to,
        rate: 0,
        fixedAmount: b.annual,
      })),
    });
    console.log(`Seeded UG-LST (${LST_BANDS.length} bands, collected Jul–Oct).`);
  }
  // The old placeholder config never drove anything; retire it.
  await prisma.hrStatutoryConfig.updateMany({
    where: { organizationId, code: 'UG-LST', isActive: true },
    data: { isActive: false },
  });

  console.log('\nDone. CONFIRM all rates against current URA/NSSF guidance before running live payroll.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
