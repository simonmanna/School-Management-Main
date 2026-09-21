/**
 * Stable codes for academic structure rows (brief §27, §46).
 *
 * Display names are not identifiers. A school renames "P4" to "Primary 4" in its
 * second week, and any CSV import, integration or saved report that resolved on
 * the name quietly starts mis-filing learners — or, worse, creates a duplicate
 * class. Codes exist so that resolution has something that does not move.
 *
 * Nothing here knows what a Ugandan grade looks like. `deriveCode('Baby Class')`
 * and `deriveCode('Grade 6')` go through the same two rules, because the moment
 * this file contains a list of grade names the system stops being configurable.
 */

/** Longest code we will store. Comfortably fits "ADVANCEDSECONDARY". */
const MAX_CODE_LENGTH = 32;

/**
 * Canonical form of a code supplied by a user: upper-case, with separators and
 * punctuation removed. "p-4", "P.4" and "p 4" are the same code, so a school
 * cannot end up with three classes it believes are one.
 */
export function normaliseCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, MAX_CODE_LENGTH);
}

/**
 * Derive a code from a display name, for callers that did not supply one.
 *
 * Returns an empty string when the name has no alphanumeric content at all (a
 * class named "—" or "???"). The caller decides what to do with that: the
 * service leaves `code` null rather than inventing one, and the nullable unique
 * index tolerates it. A wrong-but-plausible code is harder to notice than a
 * missing one.
 */
export function deriveCode(name: string): string {
  return normaliseCode(name);
}

/**
 * Make `candidate` unique against codes already taken, by appending -2, -3, …
 *
 * Used by bulk paths (import, seeding) where several rows can derive the same
 * code in one pass and the database would only report the first collision.
 */
export function uniqueCode(candidate: string, taken: Set<string>): string {
  if (!candidate) return candidate;
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; n < 1000; n += 1) {
    const next = `${candidate}-${n}`.slice(0, MAX_CODE_LENGTH);
    if (!taken.has(next)) return next;
  }
  throw new Error(`Could not derive a unique code from "${candidate}" after 999 attempts.`);
}
