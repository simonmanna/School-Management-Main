import * as fs from 'fs';
import * as path from 'path';

/**
 * Academic retirement ratchets (ADR-027, ADR-028, ADR-029).
 *
 * Three legacy academic concepts are being retired, each over several releases:
 *
 *   1. `StudentProfile.currentClassId/currentSectionId/currentStreamId` — the
 *      schema calls these PROJECTIONS of the newest open `EnrollmentPlacement`
 *      (schema.prisma:12112) and says they are never read as truth. They are, in
 *      35 files. Fee billing, mark-entry rosters and statutory exports all key
 *      off them, so each silently reports the wrong class the moment a learner
 *      moves mid-term.
 *   2. The legacy `Stream` table — superseded by `Section` as the single
 *      subdivision (ADR-029).
 *   3. The same projection reads in the web and portal clients, which must reach
 *      zero BEFORE the columns are dropped, or the UI points at a dead field.
 *
 * Retiring 35 + 32 files in one change is not reviewable, so these ledgers make
 * the migration mechanical instead. Each is SHRINK-ONLY, in both directions:
 *
 *   - A file that starts referencing a retired concept fails the spec, so the
 *     problem cannot grow while we drain it.
 *   - A file that is converted but left in the ledger ALSO fails, so progress is
 *     acknowledged deliberately rather than drifting out of date.
 *
 * Deleting a ledger file is the proof that its concept is fully retired: the
 * spec below then requires zero hits.
 */

const SRC = path.resolve(__dirname, '../../src');
const REPO = path.resolve(__dirname, '../../../..');

/** The client ratchet walks two app trees rather than one directory. */
const CLIENT_ROOTS = ['apps/web/src', 'apps/portal/src'];

interface Ratchet {
  /** What is being retired, for the failure message. */
  concept: string;
  /** Directories walked, and the base that ledger paths are relative to. */
  roots: string[];
  base: string;
  pattern: RegExp;
  ledger: string;
  extensions: RegExp;
}

const RATCHETS: Ratchet[] = [
  {
    concept: 'StudentProfile.current* projection reads (apps/api)',
    roots: [SRC],
    base: SRC,
    pattern: /currentClassId|currentSectionId|currentStreamId/,
    ledger: path.resolve(__dirname, './projection-reader-ledger.json'),
    extensions: /\.ts$/,
  },
  {
    concept: 'legacy Stream table references (apps/api school module)',
    roots: [path.join(SRC, 'modules/school')],
    base: SRC,
    pattern: /\bstreamId\b|\bStream\b/,
    ledger: path.resolve(__dirname, './stream-reader-ledger.json'),
    extensions: /\.ts$/,
  },
  {
    // The legacy per-term `Enrollment` / `EnrollmentHistory` tables are dropped
    // with the projection (ADR-027). Their readers were not tracked by the two
    // ratchets above, which is how `admissions.enrollmentSummary` and the report
    // filter resolver were found reading them only while converting something
    // else. Every Prisma call on either table must be gone before the drop.
    concept: 'legacy Enrollment / EnrollmentHistory table access (apps/api)',
    roots: [SRC],
    base: SRC,
    pattern:
      /\.enrollment\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|create|createMany|update|updateMany|upsert|delete|deleteMany|groupBy|aggregate)\b|\.enrollmentHistory\./,
    ledger: path.resolve(__dirname, './legacy-enrollment-ledger.json'),
    extensions: /\.ts$/,
  },
  {
    concept: 'StudentProfile.current* projection reads (web + portal clients)',
    roots: CLIENT_ROOTS.map((p) => path.join(REPO, p)),
    base: REPO,
    pattern: /currentClassId|currentSectionId|currentStreamId/,
    ledger: path.resolve(__dirname, './client-projection-reader-ledger.json'),
    extensions: /\.tsx?$/,
  },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function currentHits(r: Ratchet): string[] {
  return r.roots
    .flatMap((root) => walk(root))
    .filter((f) => r.extensions.test(f))
    .filter((f) => r.pattern.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(r.base, f).split(path.sep).join('/'))
    .sort();
}

describe('academic retirement ratchets', () => {
  for (const r of RATCHETS) {
    describe(r.concept, () => {
      // A missing ledger means the concept is fully retired. In that state the
      // only acceptable number of hits is zero.
      const ledgerExists = fs.existsSync(r.ledger);
      const allowed: string[] = ledgerExists
        ? (JSON.parse(fs.readFileSync(r.ledger, 'utf-8')) as string[])
        : [];

      it('has no references outside the ledger', () => {
        const unlisted = currentHits(r).filter((f) => !allowed.includes(f));
        if (unlisted.length > 0) {
          throw new Error(
            'New references to ' + r.concept + '.\n' +
              'These must go through PlacementLookupService (or Section) instead:\n' +
              unlisted.map((f) => '  - ' + f).join('\n'),
          );
        }
      });

      it('has no stale ledger entries', () => {
        if (!ledgerExists) return;
        const hits = new Set(currentHits(r));
        const stale = allowed.filter((f) => !hits.has(f));
        if (stale.length > 0) {
          throw new Error(
            'These files no longer reference ' + r.concept + ' — drop them from ' +
              path.basename(r.ledger) + ' in the same commit that converted them:\n' +
              stale.map((f) => '  - ' + f).join('\n'),
          );
        }
      });
    });
  }
});
