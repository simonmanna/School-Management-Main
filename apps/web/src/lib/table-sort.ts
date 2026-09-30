/**
 * Value comparison shared by <DataTable> and the DOM table enhancer, so a
 * column of amounts, dates or codes sorts the same way wherever it appears.
 */

const CURRENCY_PREFIX = /^(UGX|USD|KES|TZS|RWF|EUR|GBP|ZAR|NGN|GHS|Ush|Shs?)\.?/i;
const NUMERIC = /^(\()?([-+−]?\d+(?:\.\d+)?)(%)?(\))?$/;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** "UGX 1,250,000", "(3,400)", "12.5%", "−7" → number; anything else → null. */
export function parseNumber(text: string): number | null {
  const t = text.replace(/[\s, ]/g, '').replace(CURRENCY_PREFIX, '').replace(/^[$€£₦]/, '');
  const m = NUMERIC.exec(t);
  if (!m) return null;
  const v = parseFloat(m[2].replace('−', '-'));
  if (Number.isNaN(v)) return null;
  return m[1] && m[4] ? -v : v;
}

/** ISO, "30 Sep 2026", "30/09/2026" (day first, as the app prints it) → epoch ms. */
export function parseDate(text: string): number | null {
  const s = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[a-z]*[\s/,-]*(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  }
  m = /^([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    return Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || v.trim() === '—' || v.trim() === '-'));
}

/**
 * Compare two cell values. Empty cells always sink to the bottom whatever the
 * direction, so a descending sort still leads with real figures.
 */
export function compareCellValues(a: unknown, b: unknown, dir: 1 | -1): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (a instanceof Date || b instanceof Date) {
    return (new Date(a as Date).getTime() - new Date(b as Date).getTime()) * dir;
  }
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * dir;
  const sa = String(a);
  const sb = String(b);
  const na = parseNumber(sa);
  const nb = parseNumber(sb);
  if (na !== null && nb !== null) return (na - nb) * dir;
  const da = parseDate(sa);
  const db = parseDate(sb);
  if (da !== null && db !== null) return (da - db) * dir;
  return collator.compare(sa, sb) * dir;
}
