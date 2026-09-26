import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { dec, round, ZERO } from '../../../kernel/common/money';
import { EVENTS } from '@erp/shared';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import type { ChargeFeeDto, PayApplicationFeeDto } from './dto.types';
import { SCHOOL_ACCOUNTS } from '../fees/school-accounts';
import { normalizePhone } from '../people/guardian.service';

export type AdmissionFeeState = 'unpaid' | 'pending' | 'paid' | 'waived';

/**
 * Admission / application fee on the canonical financial path.
 *
 *   charge → posted sales_invoice (Dr AR / Cr Admission Fee Revenue)
 *   pay    → PaymentService.createReceipt allocated to that invoice
 *   waive  → void the unpaid invoice (GL reversal, status cancelled)
 *
 * Whether the fee is settled is read from the invoice (the subledger), never
 * from a flag. `AdmissionApplication.feeStatus` / `AdmissionFee.paid` are
 * display projections kept in step by `sync`.
 */
@Injectable()
export class AdmissionFeeService implements OnModuleInit {
  private readonly logger = new Logger(AdmissionFeeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly documentBuilder: DocumentBuilderService,
    private readonly payments: PaymentService,
    private readonly posting: PostingService,
    private readonly resolver: AccountResolverService,
  ) {}

  onModuleInit() {
    // A payment taken anywhere (fee desk, bank import, MoMo) that clears the
    // invoice must move the application forward.
    this.events.subscribe('invoice.paid' as any, async (p: any) => {
      try {
        await this.syncByInvoice(p.documentId);
      } catch (err) {
        this.logger.error(`admission fee sync failed: ${(err as Error).message}`);
      }
    });
  }

  async charge(applicationId: string, dto: ChargeFeeDto) {
    const amount = round(dec(dto.amount), 2);
    if (amount.lessThanOrEqualTo(ZERO)) throw new BadRequestException('Application fee must be above zero.');

    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      if (['rejected', 'withdrawn', 'enrolled'].includes(app.status)) {
        throw new BadRequestException(`Cannot charge an application fee on a '${app.status}' application.`);
      }

      const current = app.feeInvoiceId ? await tx.document.findFirst({ where: { id: app.feeInvoiceId } }) : null;
      if (current && current.status !== 'cancelled') {
        if (dec(current.amountPaid).greaterThan(ZERO)) {
          throw new BadRequestException(
            `Application fee ${current.documentNumber} has payments against it and cannot be re-charged.`,
          );
        }
        // Re-charging an unpaid fee replaces it: void the old invoice first so
        // exactly one live receivable exists for the application.
        await this.voidInvoice(tx, current, 'Application fee re-charged');
      }

      const partnerId = await this.feePartnerId(tx, app);
      const revenueAccount = await this.resolver.ensureByCode(
        SCHOOL_ACCOUNTS.admissionFeeRevenue.code,
        SCHOOL_ACCOUNTS.admissionFeeRevenue,
        tx,
      );
      const issueDate = new Date();
      const doc = await this.documentBuilder.createDocument(
        tx,
        'sales_invoice',
        {
          partnerId,
          issueDate: issueDate.toISOString(),
          dueDate: issueDate.toISOString(),
          reference: `ADMISSION-FEE-${app.applicationNumber}`,
          notes: `Application fee for ${app.applicantFirstName} ${app.applicantLastName}`,
          sourceType: 'school_admission_fee',
        },
        [
          {
            accountId: revenueAccount,
            description: `Application fee · ${app.applicationNumber}`,
            quantity: 1,
            unitPrice: amount.toNumber(),
          },
        ],
      );
      await tx.document.update({ where: { id: doc.id }, data: { sourceId: app.id } });
      const full = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });

      const entry = await this.posting.post(
        {
          journalCode: 'SALES',
          date: issueDate,
          description: `Admission fee · ${full.documentNumber}`,
          sourceType: 'school_admission_fee_invoice',
          sourceId: full.id,
          postingKey: `school_admission_fee:${full.id}`,
          lines: await this.documentBuilder.salesPostingLines(tx, full, {
            receivable: `Admission fee ${full.documentNumber}`,
            revenue: 'Admission fee revenue',
          }),
        },
        tx,
      );
      const posted = await tx.document.update({
        where: { id: full.id },
        data: {
          status: 'posted',
          paymentStatus: 'not_paid',
          amountResidual: full.totalAmount,
          amountPaid: 0,
          journalEntryId: entry.id,
          postedAt: issueDate,
        },
      });

      await tx.admissionFee.upsert({
        where: { applicationId },
        create: { organizationId: app.organizationId, applicationId, amount, invoiceId: posted.id },
        update: { amount, invoiceId: posted.id, paid: false, paidAt: null },
      });
      await tx.admissionApplication.updateMany({
        where: { id: applicationId },
        data: { feeStatus: 'pending', feeInvoiceId: posted.id },
      });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: applicationId,
        action: 'update' as const,
        oldValues: { feeStatus: app.feeStatus, feeInvoiceId: app.feeInvoiceId },
        newValues: { feeStatus: 'pending', feeInvoiceId: posted.id, amount: amount.toString() },
      });
      await this.events.publishInTx(tx, EVENTS.SchoolAdmissionFeeInvoiced, {
        organizationId: app.organizationId,
        applicationId,
        invoiceId: posted.id,
      });
      return { invoiceId: posted.id, documentNumber: posted.documentNumber, amount: amount.toNumber() };
    });
  }

  /** Take a payment for the application fee through the platform's single payment writer. */
  async pay(applicationId: string, dto: PayApplicationFeeDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      const doc = app.feeInvoiceId ? await tx.document.findFirst({ where: { id: app.feeInvoiceId } }) : null;
      if (!doc || !['posted', 'paid'].includes(doc.status)) {
        throw new BadRequestException('No application fee has been charged for this application.');
      }
      const residual = dec(doc.amountResidual);
      if (residual.lessThanOrEqualTo(ZERO)) throw new BadRequestException('The application fee is already paid.');

      const amount = round(dec(dto.amount ?? residual), 6);
      if (amount.lessThanOrEqualTo(ZERO)) throw new BadRequestException('Amount must be above zero.');
      if (amount.greaterThan(residual)) {
        throw new BadRequestException(`Amount ${amount.toString()} exceeds the outstanding fee of ${residual.toString()}.`);
      }

      const method = dto.paymentMethod ?? 'cash';
      const payment = await this.payments.createReceipt(
        {
          partnerId: doc.partnerId,
          paymentDate: (dto.paymentDate ? new Date(dto.paymentDate) : new Date()).toISOString(),
          amount: amount.toNumber(),
          paymentMethod: method,
          accountId: method === 'bank' ? dto.bankAccountId : undefined,
          reference: dto.reference ?? `Application fee ${app.applicationNumber}`,
          externalReference: dto.externalReference,
          externalReferenceType: dto.externalReference ? dto.externalReferenceType : undefined,
          cashSessionId: dto.cashSessionId,
          allocations: [{ documentId: doc.id, amount: amount.toNumber() }],
        } as any,
        tx,
      );
      const state = await this.sync(tx, applicationId);
      return { payment, feeStatus: state };
    });
  }

  /** Waive an unpaid fee: the invoice is voided (GL reversed), never silently flagged paid. */
  async waive(applicationId: string, reason?: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
      const doc = app.feeInvoiceId ? await tx.document.findFirst({ where: { id: app.feeInvoiceId } }) : null;
      if (doc && doc.status !== 'cancelled') {
        if (dec(doc.amountPaid).greaterThan(ZERO)) {
          throw new BadRequestException(
            'Money has been received against this fee. Reverse or refund the payment before waiving it.',
          );
        }
        await this.voidInvoice(tx, doc, reason ?? 'Application fee waived');
      }
      await tx.admissionFee.updateMany({ where: { applicationId }, data: { paid: false, paidAt: null } });
      await tx.admissionApplication.updateMany({ where: { id: applicationId }, data: { feeStatus: 'waived' } });
      await this.audit.recordInTx(tx, {
        entity: 'AdmissionApplication',
        entityId: applicationId,
        action: 'update' as const,
        oldValues: { feeStatus: app.feeStatus },
        newValues: { feeStatus: 'waived', reason: reason ?? null },
      });
      return { applicationId, feeStatus: 'waived' as AdmissionFeeState };
    });
  }

  /** Fee position read from the invoice and its allocations. */
  async status(applicationId: string) {
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);
    const doc = app.feeInvoiceId
      ? await this.prisma.client.document.findFirst({
          where: { id: app.feeInvoiceId },
          include: {
            allocations: {
              where: { status: 'posted' },
              include: { payment: { select: { id: true, paymentNumber: true, paymentDate: true, paymentMethod: true } } },
            },
          },
        })
      : null;
    return {
      applicationId,
      feeStatus: this.stateOf(app.feeStatus, doc),
      invoice: doc
        ? {
            id: doc.id,
            documentNumber: doc.documentNumber,
            status: doc.status,
            totalAmount: Number(doc.totalAmount),
            amountPaid: Number(doc.amountPaid),
            amountResidual: Number(doc.amountResidual),
            journalEntryId: doc.journalEntryId,
            payments: (doc.allocations ?? []).map((a) => ({
              allocationId: a.id,
              amount: Number(a.amount),
              paymentId: a.payment?.id,
              paymentNumber: a.payment?.paymentNumber,
              paymentDate: a.payment?.paymentDate,
              paymentMethod: a.payment?.paymentMethod,
            })),
          }
        : null,
    };
  }

  /** The enrollment gate's question, answered from the subledger. */
  async isSettled(client: any, app: { feeStatus?: string | null; feeInvoiceId?: string | null }): Promise<boolean> {
    if (app.feeStatus === 'waived') return true;
    if (!app.feeInvoiceId) return app.feeStatus !== 'pending';
    const doc = await client.document.findFirst({
      where: { id: app.feeInvoiceId },
      select: { status: true, amountResidual: true },
    });
    if (!doc || doc.status === 'cancelled') return app.feeStatus !== 'pending';
    return dec(doc.amountResidual).lessThanOrEqualTo(ZERO);
  }

  private stateOf(projected: string | null | undefined, doc: any): AdmissionFeeState {
    if (projected === 'waived') return 'waived';
    if (!doc || doc.status === 'cancelled') return 'unpaid';
    return dec(doc.amountResidual).lessThanOrEqualTo(ZERO) ? 'paid' : 'pending';
  }

  private async syncByInvoice(documentId: string) {
    const app = await this.prisma.client.admissionApplication.findFirst({ where: { feeInvoiceId: documentId } });
    if (!app) return;
    await this.prisma.client.$transaction((tx: any) => this.sync(tx, app.id));
  }

  /** Refresh the display projections from the invoice. */
  private async sync(tx: any, applicationId: string): Promise<AdmissionFeeState> {
    const app = await tx.admissionApplication.findFirst({ where: { id: applicationId } });
    const doc = app?.feeInvoiceId ? await tx.document.findFirst({ where: { id: app.feeInvoiceId } }) : null;
    const state = this.stateOf(app?.feeStatus, doc);
    if (state === 'waived') return state;
    const paid = state === 'paid';
    await tx.admissionFee.updateMany({
      where: { applicationId },
      data: { paid, paidAt: paid ? new Date() : null },
    });
    if (app.feeStatus !== state) {
      await tx.admissionApplication.updateMany({ where: { id: applicationId }, data: { feeStatus: state } });
    }
    return state;
  }

  private async voidInvoice(tx: any, doc: any, reason: string) {
    if (doc.journalEntryId) {
      await this.posting.reverse(doc.journalEntryId, { description: `${reason} · ${doc.documentNumber}` }, tx);
    }
    await tx.document.update({
      where: { id: doc.id },
      data: { status: 'cancelled', amountResidual: 0 },
    });
  }

  /**
   * Who pays the admission fee.
   *
   * The application form captures guardians as AdmissionGuardian rows and never
   * sends `parentContactId`, so requiring it made the fee unchargeable from the
   * UI (E2E audit AD4). Fall back to the guardian the family named as paying —
   * financially responsible, else primary, else the first listed — reusing their
   * existing contact when a sibling is already enrolled, otherwise opening a
   * payer account for them. The chosen contact is written back to
   * `parentContactId` so the charge, the payment and any waiver all bill the
   * same account.
   */
  /**
   * Re-audit #3 P1-16. At enrolment, move the application fee onto the new
   * pupil's own account.
   *
   * The fee is charged before the pupil exists, so it bills the paying
   * guardian's account: an `ADM-PAYER-*` account, or — when a sibling is
   * already enrolled — the guardian contact that belongs to the SIBLING's
   * account. Every statement, balance, portal and clearance query reads by the
   * pupil's own account, so the fee and its payment never showed for the new
   * pupil, and showed on the sibling's statement instead.
   *
   * The invoice moves, and so does every receipt that paid this fee and
   * nothing else (a receipt that also paid other invoices stays with its
   * payer). The GL AR those items carry moves with them in one transfer entry
   * — Dr AR (pupil) / Cr AR (payer) for `residual − unallocated moved` — so
   * the per-account identity `GL AR = open residual − unallocated receipts`
   * holds for both accounts afterwards. Runs inside the enrolment transaction.
   */
  async moveToStudentAccount(tx: any, applicationId: string, studentPartnerId: string, organizationId: string) {
    const docs = await tx.document.findMany({
      where: { organizationId, sourceType: 'school_admission_fee', sourceId: applicationId, status: { not: 'cancelled' } },
    });
    for (const doc of docs) {
      const from = doc.partnerId;
      if (!from || from === studentPartnerId) continue;

      const allocations = await tx.paymentAllocation.findMany({
        where: { organizationId, documentId: doc.id, status: 'posted' },
        include: { payment: true },
      });
      const moved: any[] = [];
      for (const a of allocations) {
        const p = a.payment;
        if (!p || p.partnerId !== from || p.status === 'cancelled' || moved.some((m) => m.id === p.id)) continue;
        const elsewhere = await tx.paymentAllocation.count({
          where: { organizationId, paymentId: p.id, status: 'posted', documentId: { not: doc.id } },
        });
        if (elsewhere === 0) moved.push(p);
      }

      const unallocatedMoved = moved.reduce((t, p) => t.plus(dec(p.unallocatedAmount ?? 0)), ZERO);
      const transfer = dec(doc.amountResidual).minus(unallocatedMoved);
      if (!transfer.isZero()) {
        const arLine = doc.journalEntryId
          ? await tx.journalLine.findFirst({
              where: { journalEntryId: doc.journalEntryId, debit: { gt: 0 } },
              select: { accountId: true },
            })
          : null;
        if (!arLine) {
          throw new BadRequestException(
            `Application fee ${doc.documentNumber} has no posted receivable line, so it cannot be moved to the pupil's account.`,
          );
        }
        const amount = transfer.abs().toString();
        const [dr, cr] = transfer.greaterThan(ZERO) ? [studentPartnerId, from] : [from, studentPartnerId];
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Application fee ${doc.documentNumber} moved to the pupil's account`,
            sourceType: 'school_admission_fee_transfer',
            sourceId: doc.id,
            postingKey: `school_admission_fee_transfer:${doc.id}`,
            lines: [
              { accountId: arLine.accountId, debit: amount, partnerId: dr, description: 'Application fee (to pupil)' },
              { accountId: arLine.accountId, credit: amount, partnerId: cr, description: 'Application fee (from payer)' },
            ],
          },
          tx,
        );
      }

      await tx.document.update({ where: { id: doc.id }, data: { partnerId: studentPartnerId } });
      for (const p of moved) {
        await tx.payment.update({ where: { id: p.id }, data: { partnerId: studentPartnerId } });
      }
      await this.audit.recordInTx(tx, {
        entity: 'Document',
        entityId: doc.id,
        action: 'transfer',
        oldValues: { partnerId: from },
        newValues: { partnerId: studentPartnerId, movedPayments: moved.map((p) => p.id), glTransfer: transfer.toString() },
      });
    }
  }

  private async feePartnerId(tx: any, app: any): Promise<string> {
    if (app.parentContactId) {
      const contact = await tx.contact.findFirst({ where: { id: app.parentContactId }, select: { partnerId: true } });
      if (!contact) throw new BadRequestException(`Guardian contact ${app.parentContactId} not found`);
      return contact.partnerId;
    }

    const guardians = await tx.admissionGuardian.findMany({
      where: { applicationId: app.id },
      orderBy: { createdAt: 'asc' },
    });
    const payer =
      guardians.find((g: any) => g.financiallyResponsible) ?? guardians.find((g: any) => g.isPrimary) ?? guardians[0];
    if (!payer) {
      throw new BadRequestException(
        `Application ${app.applicationNumber ?? app.id} lists no parent or guardian, so there is nobody to bill. ` +
          'Add a guardian to the application before charging the fee.',
      );
    }

    let contact: { id: string; partnerId: string } | null = payer.contactId
      ? await tx.contact.findFirst({ where: { id: payer.contactId }, select: { id: true, partnerId: true } })
      : null;

    // A parent who already has a child here is the SAME payer: match an existing
    // guardian contact on email or phone, as enrolment's guardian promotion does.
    const email = payer.email?.trim().toLowerCase() || null;
    const phone = normalizePhone(payer.phone);
    if (!contact && (email || phone)) {
      const links = await tx.studentGuardian.findMany({
        where: {
          guardianContact: {
            OR: [
              ...(email ? [{ email: { equals: email, mode: 'insensitive' } }] : []),
              ...(phone ? [{ phone: { contains: phone.slice(-9) } }] : []),
            ],
          },
        },
        include: { guardianContact: { select: { id: true, partnerId: true, email: true, phone: true } } },
        take: 20,
      });
      contact =
        links
          .map((l: any) => l.guardianContact)
          .find(
            (c: any) => (email && c.email?.trim().toLowerCase() === email) || (phone && normalizePhone(c.phone) === phone),
          ) ?? null;
    }

    if (!contact) {
      const name = [payer.firstName, payer.lastName].filter(Boolean).join(' ').trim() || 'Guardian';
      const partner = await tx.partner.create({
        data: {
          organizationId: app.organizationId,
          code: `ADM-PAYER-${app.applicationNumber ?? app.id}`,
          name,
          isCompany: false,
          isCustomer: true,
          email: payer.email ?? null,
          phone: payer.phone ?? null,
        },
      });
      contact = await tx.contact.create({
        data: {
          organizationId: app.organizationId,
          partnerId: partner.id,
          firstName: payer.firstName,
          lastName: payer.lastName ?? null,
          email: payer.email ?? null,
          phone: payer.phone ?? null,
          isPrimary: true,
        },
        select: { id: true, partnerId: true },
      });
    }

    await tx.admissionApplication.updateMany({ where: { id: app.id }, data: { parentContactId: contact!.id } });
    app.parentContactId = contact!.id;
    return contact!.partnerId;
  }
}
