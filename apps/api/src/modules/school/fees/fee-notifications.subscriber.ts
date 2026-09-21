import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../kernel/events/event-bus';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EVENTS } from '@erp/shared';
import { OPEN_FEE_WHERE } from './fee-document.constants';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * C2 / C3 — fee events → guardian notifications.
 *
 * The messaging infrastructure has existed all along and the attendance module
 * has been using it; fees had no subscriber at all. In a Ugandan school SMS is
 * not a nicety — it is how a bursar reaches a parent who has no email, does not
 * log into a portal, and lives an hour from the school. A fee reminder that
 * arrives on a phone is the single highest-leverage thing this module can send.
 *
 * Four triggers:
 *   invoice posted     → "Term 2 fees are UGX X, due 14 May."
 *   payment received   → "Received UGX X. Balance UGX Y." (C3)
 *   due-date sweep     → N days before the due date, to whoever still owes.
 *   overdue sweep      → after the due date, escalating language.
 *
 * Delivery mirrors the attendance subscriber exactly: in-app always, SMS and
 * email best-effort so a school with no provider configured still works. Every
 * message carries a `dedupeKey` so an at-least-once event bus and a re-run
 * sweep cannot spam a parent twice for the same thing on the same day.
 *
 * Money is formatted at the presentation edge only (FINANCIAL_INVARIANTS
 * §Money precision) — UGX has no minor unit, so it is rendered to zero
 * decimals here and nowhere upstream.
 */
type InvoicePostedPayload = {
  organizationId: string;
  documentId: string;
  schoolFeeInvoiceId?: string;
  studentProfileId: string;
  amount: string;
};

type PaymentRecordedPayload = {
  organizationId: string;
  paymentId: string;
  documentId: string;
  amount: string;
};

@Injectable()
export class FeeNotificationsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('FeeNotifications');

  constructor(
    private readonly events: EventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantContextService,
    private readonly finance: SchoolFinanceQueryService,
    private readonly placements: PlacementLookupService,
  ) {}

  onModuleInit() {
    this.events.subscribe(EVENTS.SchoolFeeInvoicePosted, (p: InvoicePostedPayload) => this.onInvoicePosted(p));
    this.events.subscribe(EVENTS.SchoolFeePaymentRecorded, (p: PaymentRecordedPayload) => this.onPaymentRecorded(p));
  }

  /** UGX has no minor unit — a receipt reading "UGX 250,000.00" looks wrong. */
  private ugx(v: unknown): string {
    return `UGX ${Math.round(Number(v ?? 0)).toLocaleString('en-UG')}`;
  }

  /* ── Triggers ───────────────────────────────────────────────────────── */

  private async onInvoicePosted(p: InvoicePostedPayload) {
    try {
      const doc = await this.prisma.client.document.findFirst({
        where: { id: p.documentId },
        select: { documentNumber: true, dueDate: true, totalAmount: true },
      });
      const due = doc?.dueDate ? new Date(doc.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;

      await this.notifyGuardians(p.organizationId, p.studentProfileId, 'invoice', {
        dedupeSuffix: p.documentId,
        amount: this.ugx(doc?.totalAmount ?? p.amount),
        due,
        documentNumber: doc?.documentNumber ?? '',
      });
    } catch (err) {
      // A failed SMS must never fail the billing run that triggered it.
      this.logger.error(`fee invoice notify failed: ${(err as Error).message}`);
    }
  }

  private async onPaymentRecorded(p: PaymentRecordedPayload) {
    try {
      const doc = await this.prisma.client.document.findFirst({
        where: { id: p.documentId },
        select: { partnerId: true },
      });
      if (!doc?.partnerId) return;
      const student = await this.prisma.client.studentProfile.findFirst({
        where: { organizationId: p.organizationId, partnerId: doc.partnerId },
        select: { id: true },
      });
      if (!student) return;

      const payment = await this.prisma.client.payment.findFirst({
        where: { id: p.paymentId },
        select: { paymentNumber: true, amount: true },
      });
      const balance = await this.finance.studentBalance(student.id);

      // C3: one confirmation per PAYMENT, not per allocation. A receipt that
      // settles three invoices fires this event three times; the dedupeKey
      // collapses them so the parent gets one message with the true balance.
      await this.notifyGuardians(p.organizationId, student.id, 'receipt', {
        dedupeSuffix: p.paymentId,
        amount: this.ugx(payment?.amount ?? p.amount),
        balance: this.ugx(balance.balance),
        receiptNumber: payment?.paymentNumber ?? '',
      });
    } catch (err) {
      this.logger.error(`fee payment notify failed: ${(err as Error).message}`);
    }
  }

  /* ── Sweeps ─────────────────────────────────────────────────────────── */

  /**
   * Remind everyone who still owes on invoices falling due in `daysAhead` days
   * — or, with `overdue`, everyone already past the due date.
   *
   * Returns what it sent so a bursar clicking "Remind this class" sees a count
   * rather than a silent success.
   */
  async remind(opts: {
    organizationId: string;
    classId?: string | null;
    daysAhead?: number;
    overdue?: boolean;
    minBalance?: number;
  }) {
    const { organizationId, classId, overdue } = opts;
    const minBalance = opts.minBalance ?? 1;

    const now = new Date();
    const dueWindow = new Date(now.getTime() + (opts.daysAhead ?? 7) * 86_400_000);

    const where: any = {
      ...OPEN_FEE_WHERE,
      organizationId,
      ...(overdue ? { dueDate: { lt: now } } : { dueDate: { gte: now, lte: dueWindow } }),
    };

    const docs = await this.prisma.client.document.findMany({
      where,
      select: { id: true, partnerId: true, dueDate: true, amountResidual: true },
    });
    if (docs.length === 0) return { sent: 0, skipped: 0, students: 0 };

    const partnerIds = [...new Set(docs.map((d) => d.partnerId).filter(Boolean))] as string[];
    const students = await this.prisma.client.studentProfile.findMany({
      where: {
        organizationId,
        partnerId: { in: partnerIds },
        status: 'active',
        ...(classId ? this.placements.studentWhere({ classIds: [classId] }) : {}),
      },
      select: { id: true, partnerId: true },
    });

    let sent = 0;
    let skipped = 0;
    for (const s of students) {
      const balance = await this.finance.studentBalance(s.id);
      // Nothing owed means nothing to chase — a pupil whose balance was
      // cleared by a waiver must not be sent a demand.
      if (balance.balance < minBalance) {
        skipped++;
        continue;
      }
      const oldestDue = docs
        .filter((d) => d.partnerId === s.partnerId && d.dueDate)
        .map((d) => new Date(d.dueDate as Date))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      await this.notifyGuardians(organizationId, s.id, overdue ? 'overdue' : 'due_soon', {
        // One reminder per pupil per day, however many invoices are involved.
        dedupeSuffix: new Date().toISOString().slice(0, 10),
        balance: this.ugx(balance.balance),
        due: oldestDue ? oldestDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null,
      });
      sent++;
    }
    return { sent, skipped, students: students.length };
  }

  /* ── Delivery ───────────────────────────────────────────────────────── */

  private async notifyGuardians(
    orgId: string,
    studentProfileId: string,
    kind: 'invoice' | 'receipt' | 'due_soon' | 'overdue',
    detail: Record<string, unknown> & { dedupeSuffix?: string },
  ) {
    const [links, student, profile] = await Promise.all([
      this.prisma.client.studentGuardian.findMany({
        where: { organizationId: orgId, studentProfileId, receivesStatements: true },
        include: { guardianContact: true },
      }),
      this.prisma.client.studentProfile.findFirst({
        where: { id: studentProfileId },
        include: { partner: true },
      }),
      this.prisma.client.schoolProfile.findFirst({
        where: { organizationId: orgId },
        select: { name: true },
      }),
    ]);

    const name = student?.partner?.name?.trim() || studentProfileId.slice(0, 8);
    const school = profile?.name ?? 'School';

    let title = '';
    let body = '';
    if (kind === 'invoice') {
      title = 'Fees invoiced';
      body = `${school}: fees for ${name} are ${detail.amount}${detail.due ? `, due ${detail.due}` : ''}.`;
    } else if (kind === 'receipt') {
      title = 'Payment received';
      body = `${school}: received ${detail.amount} for ${name}. Balance ${detail.balance}. Receipt ${detail.receiptNumber}.`;
    } else if (kind === 'due_soon') {
      title = 'Fees due soon';
      body = `${school}: ${name} has ${detail.balance} outstanding${detail.due ? `, due ${detail.due}` : ''}.`;
    } else {
      title = 'Fees overdue';
      body = `${school}: ${name} has ${detail.balance} outstanding, now past the due date. Please clear to avoid interruption.`;
    }

    const dedupeKey = `fee:${kind}:${studentProfileId}:${detail.dedupeSuffix ?? new Date().toISOString().slice(0, 10)}`;

    for (const link of links) {
      const c: any = link.guardianContact;
      await this.notifications
        .send({
          organizationId: orgId,
          channel: 'in_app',
          category: 'fees',
          title,
          body,
          payload: { studentProfileId, kind, ...detail, dedupeKey },
        } as any)
        .catch(() => undefined);

      // SMS is the one that matters in a Ugandan school. Best-effort: a school
      // with no provider configured still bills and collects normally.
      if (c?.phone) {
        await this.notifications
          .send({
            organizationId: orgId,
            channel: 'sms',
            category: 'fees',
            title,
            body,
            payload: { studentProfileId, kind, dedupeKey },
          } as any)
          .catch(() => undefined);
      }
      if (c?.email) {
        await this.notifications
          .send({
            organizationId: orgId,
            channel: 'email',
            category: 'fees',
            title,
            body,
            payload: { studentProfileId, kind, dedupeKey },
          } as any)
          .catch(() => undefined);
      }
    }
  }
}
