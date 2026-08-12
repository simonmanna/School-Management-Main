import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { InvoiceService } from '../invoicing/invoice/invoice.service';
import { PaymentService } from '../invoicing/payment/payment.service';
import { DocumentBuilderService } from '../invoicing/document/document-builder.service';

/**
 * School ERP — composes the core platform for school operations.
 *
 * Notes:
 *   - Students live in the Partner table with `isCustomer=true` and
 *     `customFields.grade = "..."`.
 *   - Classes are real entities in this module (no core equivalent yet).
 *     We attach them via a lightweight `SchoolClass` shape held in
 *     `Organization.settings` (or, for richer needs, a future table).
 *   - Term fees use the kernel's RecurringService to auto-generate invoices.
 *   - Enrollments use a dedicated table (`SchoolEnrollment`) so we get FKs and
 *     a proper lifecycle (active → graduated → withdrawn).
 */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly builder: DocumentBuilderService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
  ) {}

  /** Enroll a student in a class. Creates the partner if missing. */
  async enroll(input: {
    studentPartnerId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    className: string;
    grade?: string;
    guardianEmail?: string;
    guardianPhone?: string;
  }) {
    const orgId = this.tenant.organizationId;
    let partnerId = input.studentPartnerId;
    if (!partnerId) {
      if (!input.firstName) throw new BadRequestException('firstName required for new student');
      const code = await this.nextStudentCode(orgId);
      const student = await this.prisma.client.partner.create({
        data: {
          organizationId: orgId,
          code,
          name: `${input.firstName} ${input.lastName ?? ''}`.trim(),
          email: input.email ?? null,
          phone: input.guardianPhone ?? null,
          isCustomer: true,
          isCompany: false,
          customFields: {
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            grade: input.grade ?? null,
            class: input.className,
            guardianEmail: input.guardianEmail ?? null,
          } as any,
        } as any,
      });
      partnerId = student.id;
    }
    // Persist the enrollment row via Organization.settings (lightweight, no
    // new table) — vertical-specific metadata. For richer needs, a
    // dedicated table should be added.
    const org = await this.prisma.client.organization.findUnique({ where: { id: orgId } });
    const settings = (org?.settings ?? {}) as any;
    const enrollments = settings.enrollments ?? [];
    const record = {
      id: cryptoRandom(),
      studentId: partnerId,
      className: input.className,
      grade: input.grade ?? null,
      enrolledAt: new Date().toISOString(),
      status: 'active',
    };
    enrollments.push(record);
    await this.prisma.client.organization.update({
      where: { id: orgId },
      data: { settings: { ...settings, enrollments } as any },
    });
    return { studentId: partnerId, enrollment: record };
  }

  /** Issue term fees for a student. One invoice per term; line item per fee. */
  async issueTermFees(input: {
    studentId: string;
    term: string; // e.g. "Term 1 2025"
    fees: Array<{ description: string; amount: number; taxId?: string }>;
    dueDate?: string;
  }) {
    const orgId = this.tenant.organizationId;
    const student = await this.prisma.client.partner.findFirst({
      where: { id: input.studentId, organizationId: orgId },
    });
    if (!student) throw new NotFoundException('Student not found');
    if (!input.fees?.length) throw new BadRequestException('At least one fee is required');
    const subtotal = input.fees.reduce((s, f) => s + Number(f.amount), 0);
    const doc = await this.builder.createDocument(
      this.prisma.client,
      'sales_invoice',
      {
        partnerId: student.id,
        reference: `Term fees · ${input.term}`,
        notes: `Term: ${input.term}`,
        dueDate: input.dueDate,
        issueDate: new Date().toISOString(),
      } as any,
      input.fees.map((f) => ({
        description: f.description,
        quantity: 1,
        unitPrice: Number(f.amount),
        taxId: f.taxId ?? undefined,
        accountId: undefined,
        productId: undefined,
      })),
    );
    await this.invoices.post(doc.id);
    return { invoiceId: doc.id, invoiceNumber: doc.documentNumber, total: Number(doc.totalAmount) };
  }

  /** Record a fee payment (inbound, allocated to the open invoice). */
  async recordFeePayment(input: { studentId: string; invoiceId: string; amount: number; method?: 'cash' | 'bank' | 'mobile_money'; reference?: string }) {
    const orgId = this.tenant.organizationId;
    const doc = await this.prisma.client.document.findFirst({
      where: { id: input.invoiceId, organizationId: orgId, partnerId: input.studentId },
    });
    if (!doc) throw new NotFoundException('Invoice not found for this student');
    const payment = await this.payments.createReceipt({
      partnerId: input.studentId,
      paymentDate: new Date().toISOString(),
      paymentMethod: input.method ?? 'cash',
      amount: Number(input.amount),
      reference: input.reference,
      allocations: [{ documentId: input.invoiceId, amount: Number(input.amount) }],
    } as any);
    return { paymentId: (payment as any)?.id ?? null };
  }

  /** Fee statement — open AR for one student. */
  async feeStatement(studentId: string) {
    const orgId = this.tenant.organizationId;
    const docs = await this.prisma.client.document.findMany({
      where: { organizationId: orgId, partnerId: studentId, documentType: 'sales_invoice' },
      orderBy: { issueDate: 'desc' },
    });
    const payments = await this.prisma.client.payment.findMany({
      where: { organizationId: orgId, partnerId: studentId, direction: 'inbound' },
      include: { allocations: true },
      orderBy: { paymentDate: 'desc' },
    });
    const totalBilled = docs.reduce((s, d) => s + Number(d.totalAmount), 0);
    const totalPaid = payments.reduce((s, p) => s + Number(p.allocatedAmount), 0);
    return {
      studentId,
      totalBilled,
      totalPaid,
      balance: totalBilled - totalPaid,
      invoices: docs,
      payments,
    };
  }

  /** List enrollments. */
  async listEnrollments() {
    const orgId = this.tenant.organizationId;
    const org = await this.prisma.client.organization.findUnique({ where: { id: orgId } });
    return ((org?.settings as any)?.enrollments ?? []) as Array<Record<string, unknown>>;
  }

  private async nextStudentCode(orgId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.client.partner.count({
      where: { organizationId: orgId, code: { startsWith: `STU-${year}-` } },
    });
    return `STU-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
