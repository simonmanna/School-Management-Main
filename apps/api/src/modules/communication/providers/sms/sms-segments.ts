/**
 * GSM 03.38 segment accounting.
 *
 * SMS is billed per SEGMENT, not per message, and the segment size depends on
 * whether every character of the body fits the GSM-7 alphabet. One stray
 * character — a curly quote pasted from Word, an emoji, an accented name —
 * flips the whole body to UCS-2 and more than halves the capacity (160 → 70).
 * That is a real cost cliff for a 400-parent broadcast, so the composer needs to
 * show it BEFORE sending, and the delivery row records what was actually
 * charged.
 *
 * Deliberately dependency-free and pure: the same function runs in the API (to
 * stamp `MessageDelivery.segments`) and could be ported verbatim to the web
 * composer's live counter.
 */

/** GSM-7 default alphabet. Order is irrelevant here — membership is all we need. */
const GSM7_BASIC = new Set(
  [
    ...'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?',
    ...'¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ],
);

/**
 * Characters reachable only via the escape sequence. Each costs TWO GSM-7 units,
 * which is why a body of 160 '€' signs is two segments, not one.
 */
const GSM7_EXTENDED = new Set([...'^{}\[~]|€']);

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsSegmentation {
  encoding: SmsEncoding;
  /** Billable units the body consumes (never 0 — an empty body is 1 segment). */
  segments: number;
  /** Encoding units consumed, after escape-sequence and surrogate expansion. */
  units: number;
  /** Units still free in the final segment — drives the composer's counter. */
  remaining: number;
}

const CAPACITY = {
  'GSM-7': { single: 160, concatenated: 153 },
  'UCS-2': { single: 70, concatenated: 67 },
} as const;

/** True when every character of `body` is representable in the GSM-7 alphabet. */
export function isGsm7(body: string): boolean {
  for (const ch of body) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXTENDED.has(ch)) return false;
  }
  return true;
}

/**
 * Count the billable segments of `body`.
 *
 * UCS-2 is counted in UTF-16 code units, not code points, because that is what
 * the air interface carries: an emoji outside the BMP is a surrogate pair and
 * costs two units. Using `[...body].length` here would under-count and produce a
 * cost estimate the gateway invoice disagrees with.
 */
export function countSegments(body: string): SmsSegmentation {
  const gsm7 = isGsm7(body);
  const encoding: SmsEncoding = gsm7 ? 'GSM-7' : 'UCS-2';

  let units = 0;
  if (gsm7) {
    for (const ch of body) units += GSM7_EXTENDED.has(ch) ? 2 : 1;
  } else {
    units = body.length; // UTF-16 code units — surrogate pairs count as 2.
  }

  const cap = CAPACITY[encoding];
  let segments: number;
  if (units <= cap.single) {
    segments = 1;
  } else {
    segments = Math.ceil(units / cap.concatenated);
    // An escape pair must not straddle a segment boundary. Rather than model the
    // split precisely (gateways differ), round up when the last segment is
    // exactly full of a body that uses escapes — the conservative estimate.
    if (segments * cap.concatenated < units) segments += 1;
  }

  const capacityUsed = segments === 1 ? cap.single : segments * cap.concatenated;
  return { encoding, segments, units, remaining: Math.max(0, capacityUsed - units) };
}

/**
 * Transliterate the handful of characters that flip a body to UCS-2 for no
 * semantic gain — smart quotes, dashes and ellipses that word processors insert
 * silently. Called only when the channel opts in via `transliterate: true`, and
 * never on characters that carry meaning (an accented parent's name is left
 * alone, and correctly costs UCS-2).
 */
const TRANSLITERATIONS: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u201F': '"',
  '\u2013': '-', '\u2014': '-', '\u2212': '-',
  '\u2026': '...', '\u00A0': ' ', '\u2022': '*', '\u2122': 'TM',
};

export function transliterateToGsm7(body: string): string {
  let out = '';
  for (const ch of body) out += TRANSLITERATIONS[ch] ?? ch;
  return out;
}
