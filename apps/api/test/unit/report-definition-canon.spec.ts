import * as fs from 'fs';
import * as path from 'path';

/**
 * Canon guard for report definitions.
 *
 * The whole reporting layer rests on one rule: a report READS a canonical domain
 * service and never re-derives its arithmetic. That rule is unenforceable by
 * types — nothing stops someone injecting Prisma and summing a column — so it is
 * enforced the way this repo already enforces route-permission coverage: by
 * reading the source as text.
 *
 * The banned tokens are not arbitrary. Each names a specific, already-observed
 * failure:
 *
 *   amountResidual  — a CACHED PROJECTION (FINANCIAL_INVARIANTS.md). Summing it
 *                     is what let the dashboard print a different figure from
 *                     the pupil's own statement.
 *   payment.amount  — a Payment row may be cancelled or unallocated.
 *                     PaymentAllocation is the record of money actually applied.
 *   prisma.         — a definition with database access will, sooner or later,
 *                     compute a balance instead of asking for one.
 *   GradeEntry      — sealed read-only at the B6 migration. A report reading it
 *                     silently freezes at the cutover and looks plausible.
 *
 * Applies to every definition file, not only the money ones: an academic report
 * that reaches for Prisma is the same failure one domain over.
 */
const DEFINITIONS_DIR = path.resolve(
  __dirname,
  '../../src/modules/school/reporting/definitions',
);

const BANNED: Array<{ token: RegExp; why: string }> = [
  { token: /\bamountResidual\b/, why: 'a cached projection — read SchoolFinanceQueryService instead' },
  { token: /\bpayment\.amount\b/, why: 'use PaymentAllocation, not raw Payment rows' },
  { token: /\bprisma\./, why: 'definitions must not touch the database — add a method to the canonical service' },
  { token: /\bGradeEntry\b/, why: 'sealed read-only since B6 — read the assessment spine' },
];

function definitionFiles(): string[] {
  if (!fs.existsSync(DEFINITIONS_DIR)) return [];
  return fs
    .readdirSync(DEFINITIONS_DIR)
    .filter((f) => f.endsWith('.reports.ts'))
    .map((f) => path.join(DEFINITIONS_DIR, f));
}

/** Strip comments so the prose explaining a ban does not trip it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('report definition canon', () => {
  const files = definitionFiles();

  it('there is at least one definition file to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.basename(f), f]))(
    '%s re-derives nothing',
    (_name, file) => {
      const code = stripComments(fs.readFileSync(file as string, 'utf-8'));
      const violations: string[] = [];
      for (const { token, why } of BANNED) {
        if (token.test(code)) {
          violations.push(`"${token.source}" — ${why}`);
        }
      }
      expect(violations).toEqual([]);
    },
  );

  it('every definition file exports a builder taking the deps bag', () => {
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf-8');
      expect(code).toMatch(/export function \w+Reports\(deps: SchoolReportDeps\)/);
    }
  });
});
