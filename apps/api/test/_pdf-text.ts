/**
 * Test-only text extraction for the PDFs this API renders with pdfkit.
 *
 * pdfkit Flate-compresses each content stream and, for the standard fonts,
 * writes text as hex strings inside TJ arrays split by kerning numbers:
 *   [<4b61> 20 <6d70616c61>] TJ
 * Inflating every stream and joining each TJ array's hex runs recovers the
 * visible strings well enough to assert "the pupil's name is on the page"
 * without adding a PDF parser dependency.
 */
import { inflateSync } from 'node:zlib';

export function pdfText(pdf: Buffer): string {
  const src = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endstream', start);
    if (end < 0) break;
    const bytes = Buffer.from(src.slice(start, end), 'latin1');
    let content: string;
    try {
      content = inflateSync(bytes).toString('latin1');
    } catch {
      content = bytes.toString('latin1');
    }
    for (const arr of content.match(/\[([^\]]*)\]\s*TJ/g) ?? []) {
      const hex = arr.match(/<([0-9a-fA-F]*)>/g) ?? [];
      out.push(hex.map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join(''));
    }
    re.lastIndex = end;
  }
  return out.join('\n');
}

/** Structural sanity: a complete PDF of a plausible size. */
export function expectPdf(pdf: Buffer, minBytes = 1024): void {
  expect(Buffer.isBuffer(pdf)).toBe(true);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.subarray(-8).toString('latin1')).toContain('%%EOF');
  expect(pdf.length).toBeGreaterThan(minBytes);
}
