import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import {
  MM,
  drawFields,
  drawLetterhead,
  drawSignatures,
  drawTitle,
  drawVerificationFooter,
  fmtDate,
  fmtMoney,
  loadLetterhead,
  renderPdf,
  verifyUrlFor,
} from '../documents/school-pdf';

const DEPARTURE: Record<string, string> = {
  withdrawn: 'Withdrawn',
  transferred: 'Transferred',
  graduated: 'Completed studies',
  alumni: 'Completed studies',
};

/**
 * Printable certificates (Wave 16). A leaving certificate gets the full
 * transfer form; every other type prints as a formal award. The printout is
 * rendered from the snapshot taken at issue, never from today's record, and a
 * revoked or void certificate is stamped as such rather than refused, so the
 * office can still print a copy for the file.
 */
@Injectable()
export class CertificatePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async generatePdf(certificateId: string): Promise<{ filename: string; pdf: Buffer }> {
    const cert = await this.prisma.client.certificate.findFirst({ where: { id: certificateId } });
    if (!cert) throw new NotFoundException(`Certificate ${certificateId} not found`);
    const school = await loadLetterhead(this.prisma.client, this.tenant.organizationId);
    const p: any = cert.payload ?? {};
    const holder = String(p.holderName ?? 'Unknown');

    const pdf = await renderPdf(
      { size: 'A4', margins: { top: 18 * MM, bottom: 18 * MM, left: 20 * MM, right: 20 * MM }, info: { Title: `${cert.title} — ${holder}` } },
      (doc) => {
        let y = drawLetterhead(doc, school);
        y = drawTitle(doc, cert.title, y + 4, 16);

        if (cert.type === 'leaving') {
          const fees =
            p.feesCleared === true
              ? 'Cleared'
              : p.feesCleared === false
                ? `Outstanding: ${fmtMoney(Number(p.feesOutstanding ?? 0))}`
                : 'Not recorded';
          y = drawFields(
            doc,
            [
              ['Name of pupil', holder],
              ['Admission number', String(p.admissionNo ?? '')],
              ['Date of birth', fmtDate(p.dateOfBirth)],
              ['Sex', String(p.gender ?? '')],
              ['Nationality', String(p.nationality ?? '')],
              ['Date of admission', fmtDate(p.admissionDate)],
              ['Date of leaving', fmtDate(p.leavingDate)],
              ['Class last attended', String(p.lastClass ?? '')],
              ['Status', DEPARTURE[p.departureStatus] ?? String(p.departureStatus ?? '')],
              ['Reason for leaving', String(p.reasonForLeaving ?? '')],
              ['School joining', String(p.destinationSchool ?? '')],
              ['Conduct', String(p.conduct ?? '')],
              ['School fees', fees],
              ['Remarks', String(p.remarks ?? '')],
            ],
            y + 6,
          );
          y = drawSignatures(doc, ['Class Teacher', 'Head Teacher (sign & stamp)', 'Date'], y + 30);
        } else {
          const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
          doc.font('Helvetica').fontSize(12).text('This is to certify that', doc.page.margins.left, y + 30, { width, align: 'center' });
          doc.font('Helvetica-Bold').fontSize(22).text(holder, { width, align: 'center' });
          doc.moveDown(0.6);
          const body = String(p.summary ?? p.citation ?? `has been awarded this ${cert.title}.`);
          doc.font('Helvetica').fontSize(12).text(body, { width, align: 'center' });
          if (cert.issuedAt) doc.moveDown(0.8).fontSize(10).text(`Issued on ${fmtDate(cert.issuedAt)}`, { width, align: 'center' });
          y = drawSignatures(doc, ['Head Teacher', 'Chairperson, Board of Governors'], doc.y + 60);
        }

        if (cert.status !== 'issued') {
          doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
          doc.font('Helvetica-Bold').fontSize(72).fillColor('#c00').opacity(0.25);
          doc.text(String(cert.status).toUpperCase(), 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
          doc.restore();
          doc.opacity(1).fillColor('#000');
        }
        drawVerificationFooter(doc, cert.serialNumber, cert.verificationCode, verifyUrlFor(cert.verificationCode));
      },
    );
    return { filename: `${cert.serialNumber}.pdf`, pdf };
  }
}
