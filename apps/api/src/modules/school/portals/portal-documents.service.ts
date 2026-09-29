import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../../kernel/auth/portal-identity.service';
import { ReportCardPdfService } from '../examinations/report-card-pdf.service';
import { FeeReceiptPdfService } from '../fees/fee-receipt-pdf.service';

/**
 * Documents a family may download for themselves.
 *
 * The admin app already serves report-card PDFs and fee statements, but both
 * routes are gated on `school:read` and key off ids that are not the caller's —
 * `GET school/report-cards/:id/pdf` takes a report-card id, so no amount of
 * student-scoping on the URL would have secured it. This service is the portal's
 * own door onto the same generators, with two rules the staff routes do not need:
 *
 *  1. The document must belong to a pupil this caller holds.
 *  2. A report card must be PUBLISHED. `ReportCard.publishedAt` is what the
 *     school sets when it has decided a family may see the marks; an unpublished
 *     card is a draft that is still being argued about internally.
 */
@Injectable()
export class PortalDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly portalIdentity: PortalIdentityService,
    private readonly pdf: ReportCardPdfService,
    private readonly receipts: FeeReceiptPdfService,
  ) {}

  /** Wave 16: the pupil's posted fee receipts, newest first. */
  async feeReceipts(studentProfileId: string) {
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId, organizationId: this.org },
      select: { partnerId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.prisma.client.payment.findMany({
      where: { organizationId: this.org, partnerId: student.partnerId, direction: 'inbound', status: 'posted' },
      orderBy: { paymentDate: 'desc' },
      take: 50,
      select: { id: true, paymentNumber: true, paymentDate: true, amount: true, paymentMethod: true },
    });
  }

  /**
   * One receipt as a PDF, for a family. Ownership is resolved from the payment's
   * payer, never from the URL; a receipt that is not theirs is "not found".
   */
  async feeReceiptPdf(paymentId: string): Promise<{ buffer: Buffer; filename: string }> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, organizationId: this.org, direction: 'inbound' },
      select: { partnerId: true },
    });
    const student = payment
      ? await this.prisma.client.studentProfile.findFirst({ where: { organizationId: this.org, partnerId: payment.partnerId }, select: { id: true } })
      : null;
    if (!student || !(await this.portalIdentity.canAccessStudent(student.id))) {
      throw new NotFoundException('Receipt not found');
    }
    const { pdf, filename } = await this.receipts.generate(paymentId, 'a4', 'family');
    return { buffer: pdf, filename };
  }

  private get org() {
    return this.tenant.organizationId;
  }

  /** Report cards this pupil's family may see: published ones, newest first. */
  async publishedReportCards(studentProfileId: string) {
    const rows = await this.prisma.client.reportCard.findMany({
      where: { organizationId: this.org, studentProfileId, publishedAt: { not: null } },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        termId: true,
        generatedAt: true,
        publishedAt: true,
        classTeacherComment: true,
        principalComment: true,
      },
    });

    // Term names, so the list does not read as a column of uuids.
    const termIds = [...new Set(rows.map((r) => r.termId))];
    const terms = termIds.length
      ? await this.prisma.client.term.findMany({
          where: { id: { in: termIds }, organizationId: this.org },
          select: { id: true, name: true },
        })
      : [];
    const termName = new Map(terms.map((t) => [t.id, t.name]));

    return rows.map((r) => ({ ...r, termName: termName.get(r.termId) ?? null }));
  }

  /**
   * One report card as a PDF, for a family.
   *
   * Ownership is resolved from the card, not from the request: the caller names
   * a report-card id, and the pupil it belongs to is looked up and checked
   * against the token's portal claim. A "not found" is returned for a card that
   * exists but is not theirs, deliberately — a 403 would confirm the id is real.
   */
  async reportCardPdf(reportCardId: string): Promise<{ buffer: Buffer; filename: string }> {
    const card = await this.prisma.client.reportCard.findFirst({
      where: { id: reportCardId, organizationId: this.org },
      select: { id: true, studentProfileId: true, publishedAt: true, termId: true },
    });
    if (!card) throw new NotFoundException('Report card not found');

    if (!(await this.portalIdentity.canAccessStudent(card.studentProfileId))) {
      throw new NotFoundException('Report card not found');
    }
    if (!card.publishedAt) {
      // Distinct from the ownership case on purpose: this IS their card, and
      // "not released yet" is the true and useful answer.
      throw new ForbiddenException('This report card has not been released yet');
    }

    const buffer = await this.pdf.generatePdf(card.id);
    return { buffer, filename: `report-card-${card.id}.pdf` };
  }
}
