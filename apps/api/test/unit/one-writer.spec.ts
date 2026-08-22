/**
 * The one-writer rule, enforced by scanning the source.
 *
 * `StudentAssessment.originalScore / effectiveScore / percentage` are DERIVED.
 * Only `MarkingService.recompute` may write them, and only `MarkingService`
 * may touch the `MarkEntry` ledger they are derived from. Everything that
 * produces a mark — exam projection, assignment, homework, quiz, LMS activity,
 * gradebook cell, CSV import — goes through `MarkingService.postMark`.
 *
 * Three producers had each grown their own version of that sequence, and they
 * disagreed: two skipped the ledger entirely and wrote the derived columns
 * directly, which meant a later recompute silently erased the score. 19 live
 * rows were in that state when this rule was written down.
 *
 * A source scan is a blunt instrument, but it is the only kind of test that
 * catches the FOURTH producer somebody adds in six months. Runtime tests only
 * cover the producers that already exist.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SCHOOL_SRC = join(__dirname, '..', '..', 'src', 'modules', 'school');

/** `marking.service.ts` owns the ledger and the derived columns. */
const LEDGER_OWNER = join('assessment', 'marking.service.ts');

/**
 * The exam projection re-posts marks that GradeEntry has already approved — it
 * is the adapter for the legacy write surface, not a new producer.
 */
const MAY_POST_WHEN_APPROVED = [
  join('assessment', 'marking.service.ts'),
  join('assessment', 'assessment-projection.service.ts'),
  join('assessment', 'cbt-result-bridge.service.ts'),
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SCHOOL_SRC).map((full) => ({
  path: relative(SCHOOL_SRC, full).split('/').join(sep),
  text: readFileSync(full, 'utf8'),
}));

/** Strip comments so a rule is never tripped by prose describing the rule. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('one-writer rule', () => {
  it('finds the school source tree', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.path)).toContain(LEDGER_OWNER);
  });

  it('only marking.service.ts writes the derived score columns', () => {
    // A `data:` payload naming any derived column on a studentAssessment write.
    const derivedWrite = /studentAssessment\s*\.\s*(?:update|updateMany|upsert|create|createMany)\s*\(([\s\S]{0,900}?)\)\s*;/g;
    const derived = /\b(effectiveScore|originalScore|percentage)\s*:/;

    const offenders: string[] = [];
    for (const f of files) {
      if (f.path === LEDGER_OWNER) continue;
      const body = code(f.text);
      for (const m of body.matchAll(derivedWrite)) {
        if (derived.test(m[1])) offenders.push(`${f.path}: ${m[0].slice(0, 120).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only marking.service.ts writes the MarkEntry ledger', () => {
    const ledgerWrite = /markEntry\s*\.\s*(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/;
    const offenders = files
      .filter((f) => f.path !== LEDGER_OWNER && ledgerWrite.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('restricts allowWhenApproved to the legacy adapter paths', () => {
    const offenders = files
      .filter((f) => !MAY_POST_WHEN_APPROVED.includes(f.path))
      .filter((f) => /allowWhenApproved\s*:\s*true/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps recompute callable only from the service that owns it', () => {
    // Producers call postMark; recompute is an internal step of postMark. A
    // direct call means a producer is assembling the sequence by hand again.
    const offenders = files
      .filter((f) => f.path !== LEDGER_OWNER)
      .filter((f) => /\.recompute\s*\(/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
