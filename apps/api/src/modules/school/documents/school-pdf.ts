import PDFDocument from 'pdfkit';

/**
 * Shared pdfkit furniture for the school's official printouts (Wave 16):
 * leaving certificates, fee receipts, registers, promotion lists.
 *
 * The report card has its own, far richer layout engine and does not use this.
 * These documents are simpler and should all look like they came from the same
 * office: the same letterhead, the same signature lines, the same verification
 * footer.
 */

export interface SchoolLetterhead {
  name: string;
  motto?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
}

export const MM = 72 / 25.4;

/** Loads the letterhead fields from the org's SchoolProfile (or sensible blanks). */
export async function loadLetterhead(client: any, organizationId: string): Promise<SchoolLetterhead> {
  const [school, org] = await Promise.all([
    client.schoolProfile.findFirst({ where: { organizationId } }),
    client.organization.findFirst({ where: { id: organizationId }, select: { name: true } }),
  ]);
  return {
    name: school?.name ?? org?.name ?? 'School',
    motto: school?.motto ?? null,
    address: school?.address ?? null,
    phone: school?.phone ?? null,
    email: school?.email ?? null,
    logoUrl: school?.logoUrl ?? null,
  };
}

/** Collect a pdfkit document into a Buffer. `draw` runs synchronously on the doc. */
export function renderPdf(options: PDFKit.PDFDocumentOptions, draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function dataUriToBuffer(url?: string | null): Buffer | null {
  if (!url || !url.startsWith('data:image/')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  try {
    return Buffer.from(url.slice(comma + 1), 'base64');
  } catch {
    return null;
  }
}

/** Centred letterhead with optional logo; returns the y below it. */
export function drawLetterhead(doc: PDFKit.PDFDocument, school: SchoolLetterhead, opts: { compact?: boolean } = {}): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.page.margins.top;
  const logo = opts.compact ? null : dataUriToBuffer(school.logoUrl);
  if (logo) {
    try {
      const size = 48;
      doc.image(logo, left + (width - size) / 2, y, { fit: [size, size], align: 'center', valign: 'center' });
      y += size + 4;
    } catch {
      /* a corrupt logo must not stop an official document printing */
    }
  }
  doc.font('Helvetica-Bold').fontSize(opts.compact ? 11 : 16).text(school.name.toUpperCase(), left, y, { width, align: 'center' });
  y = doc.y + 2;
  doc.font('Helvetica-Oblique').fontSize(opts.compact ? 7 : 9);
  if (school.motto) {
    doc.text(school.motto, left, y, { width, align: 'center' });
    y = doc.y + 1;
  }
  doc.font('Helvetica').fontSize(opts.compact ? 7 : 8.5);
  const contact = [school.address, school.phone, school.email].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.text(contact, left, y, { width, align: 'center' });
    y = doc.y;
  }
  y += 4;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(opts.compact ? 0.5 : 1.2).stroke();
  return y + (opts.compact ? 4 : 10);
}

/** A document title, centred. */
export function drawTitle(doc: PDFKit.PDFDocument, title: string, y: number, size = 14): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(size).text(title.toUpperCase(), left, y, { width, align: 'center', characterSpacing: 1 });
  return doc.y + 10;
}

/** Label / value rows with dotted leaders, as on a paper form. */
export function drawFields(doc: PDFKit.PDFDocument, rows: Array<[string, string]>, y: number, labelWidth = 150): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fontSize(10).text(label, left, y, { width: labelWidth });
    const valueY = y;
    doc.font('Helvetica').fontSize(10).text(value || '—', left + labelWidth, valueY, { width: width - labelWidth });
    const bottom = Math.max(doc.y, valueY + 12);
    doc.save().dash(1, { space: 2 }).moveTo(left + labelWidth, bottom + 1).lineTo(left + width, bottom + 1).lineWidth(0.4).strokeColor('#999').stroke().undash().restore();
    y = bottom + 8;
  }
  return y;
}

/** Signature lines side by side. */
export function drawSignatures(doc: PDFKit.PDFDocument, labels: string[], y: number): number {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 24;
  const w = (width - gap * (labels.length - 1)) / labels.length;
  labels.forEach((label, i) => {
    const x = left + i * (w + gap);
    doc.moveTo(x, y + 24).lineTo(x + w, y + 24).lineWidth(0.6).strokeColor('#000').stroke();
    doc.font('Helvetica').fontSize(8.5).text(label, x, y + 28, { width: w, align: 'center' });
  });
  return y + 48;
}

/** Serial + verification code footer at the page bottom. */
export function drawVerificationFooter(doc: PDFKit.PDFDocument, serial: string, code: string, verifyUrl?: string | null) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 28;
  doc.font('Helvetica').fontSize(8).fillColor('#333');
  doc.text(`Serial: ${serial}     Verification code: ${code}`, left, y, { width, align: 'center', lineBreak: false });
  if (verifyUrl) doc.text(`Verify at ${verifyUrl}`, left, y + 11, { width, align: 'center', lineBreak: false });
  doc.fillColor('#000');
}

/** Public verification link for a code, when the portal URL is configured. */
export function verifyUrlFor(code: string): string | null {
  const base = (process.env.PORTAL_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/verify?code=${encodeURIComponent(code)}` : null;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function fmtMoney(n: number, currency = 'UGX'): string {
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
}
