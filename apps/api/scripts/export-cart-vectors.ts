/**
 * Golden-vector exporter — pricing parity between the server and the Android
 * app's CartEngine.
 *
 * The Android terminal prices carts offline and prints a receipt the customer
 * takes away; hours later the server re-prices the same cart on sync. Those
 * two numbers MUST agree, or the receipt is a lie and the books won't match.
 *
 * This script runs the REAL server pricing path (TaxCalculationService + the
 * same transaction-discount folding PosInvoiceService uses) over a set of
 * scenarios and writes the expected totals to the Android test resources.
 * CartEngineTest asserts Kotlin reproduces them.
 *
 * Run:  pnpm --filter @erp/api exec ts-node scripts/export-cart-vectors.ts
 * Then: cd apps/android && ./gradlew :app:testDebugUnitTest
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TaxCalculationService } from '../src/modules/invoicing/tax/tax-calculation.service';
import { dec } from '../src/kernel/common/money';

const tax = new TaxCalculationService();

interface VectorLine {
  name: string;
  quantity: number;
  /** Base/variant unit price BEFORE add-ons (major units). */
  baseUnitPrice: number;
  modifierDeltas?: number[];
  accompanimentImpacts?: number[];
  discountPercent?: number;
  taxRatePercent?: number;
  taxInclusive?: boolean;
}

interface Vector {
  id: string;
  description: string;
  transactionDiscountPercent?: number;
  lines: VectorLine[];
}

/** Scenarios worth locking down — each one has burned someone somewhere. */
const VECTORS: Vector[] = [
  { id: 'plain', description: 'single line, no tax, no discount', lines: [{ name: 'Espresso', quantity: 2, baseUnitPrice: 5000 }] },
  { id: 'vat18-exclusive', description: 'VAT 18% added on top', lines: [{ name: 'Latte', quantity: 1, baseUnitPrice: 10000, taxRatePercent: 18 }] },
  { id: 'vat18-inclusive', description: 'VAT 18% already inside the price', lines: [{ name: 'Latte', quantity: 1, baseUnitPrice: 11800, taxRatePercent: 18, taxInclusive: true }] },
  {
    id: 'modifiers-and-accompaniments',
    description: 'add-on deltas + accompaniment upcharges fold into the unit price',
    lines: [{ name: 'Steak', quantity: 1, baseUnitPrice: 8000, modifierDeltas: [1000], accompanimentImpacts: [1500] }],
  },
  {
    id: 'line-discount',
    description: '10% line discount',
    lines: [{ name: 'Cake', quantity: 1, baseUnitPrice: 10000, discountPercent: 10 }],
  },
  {
    id: 'line-plus-transaction-discount',
    description: 'line discount THEN transaction discount (multiplicative, not additive)',
    transactionDiscountPercent: 10,
    lines: [{ name: 'Cake', quantity: 1, baseUnitPrice: 10000, discountPercent: 10 }],
  },
  {
    id: 'multi-line-mixed-tax',
    description: 'taxed + untaxed lines in one cart',
    lines: [
      { name: 'Latte', quantity: 2, baseUnitPrice: 10000, taxRatePercent: 18 },
      { name: 'Water', quantity: 1, baseUnitPrice: 2000 },
    ],
  },
  {
    id: 'fractional-quantity',
    description: 'weight-based line (0.35 kg)',
    lines: [{ name: 'Beans', quantity: 0.35, baseUnitPrice: 60000, taxRatePercent: 18 }],
  },
  {
    id: 'everything',
    description: 'variants + modifiers + line discount + tx discount + VAT',
    transactionDiscountPercent: 5,
    lines: [
      { name: 'Steak (Large)', quantity: 2, baseUnitPrice: 16000, modifierDeltas: [1000, 500], accompanimentImpacts: [1500], discountPercent: 10, taxRatePercent: 18 },
      { name: 'Juice', quantity: 3, baseUnitPrice: 4000, taxRatePercent: 18 },
    ],
  },
];

function computeExpected(v: Vector) {
  const txPct = v.transactionDiscountPercent ?? 0;
  const txFactor = 1 - txPct / 100;

  let subtotal = dec(0);
  let discountTotal = dec(0);
  let taxTotal = dec(0);
  let total = dec(0);

  for (const l of v.lines) {
    // Unit folding: base + modifier deltas + accompaniment upcharges. This is
    // what the server does when it resolves the line server-side.
    const unit = dec(l.baseUnitPrice)
      .plus((l.modifierDeltas ?? []).reduce((s, d) => s.plus(dec(d)), dec(0)))
      .plus((l.accompanimentImpacts ?? []).reduce((s, d) => s.plus(dec(d)), dec(0)));
    const gross = dec(l.quantity).times(unit);

    // PosInvoiceService folds the transaction discount INTO the line percent:
    //   pct' = 100 * (1 - (1 - pct/100) * txFactor)
    const linePct = l.discountPercent ?? 0;
    const foldedPct = txPct > 0 ? 100 * (1 - (1 - linePct / 100) * txFactor) : linePct;
    const discount = gross.times(dec(foldedPct).dividedBy(100));
    const afterDiscount = gross.minus(discount);

    const result = tax.computeLine(
      afterDiscount,
      l.taxRatePercent
        ? [{ id: 't', rate: l.taxRatePercent as any, isInclusive: !!l.taxInclusive, isCompound: false }]
        : [],
    );

    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(discount);
    taxTotal = taxTotal.plus(result.taxTotal);
    total = total.plus(result.gross);
  }

  const n = (d: any) => Number(Number(d.toString()).toFixed(2));
  return { subtotal: n(subtotal), discountTotal: n(discountTotal), taxTotal: n(taxTotal), total: n(total) };
}

const out = {
  _generatedBy: 'apps/api/scripts/export-cart-vectors.ts — do not hand-edit; re-run after pricing changes',
  _generatedAt: new Date().toISOString(),
  vectors: VECTORS.map((v) => ({ ...v, expected: computeExpected(v) })),
};

const target = resolve(__dirname, '../../android/app/src/test/resources/cart-vectors.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(`Wrote ${out.vectors.length} cart vectors → ${target}`);
for (const v of out.vectors) {
  console.log(`  ${v.id.padEnd(32)} total=${v.expected.total} tax=${v.expected.taxTotal}`);
}
