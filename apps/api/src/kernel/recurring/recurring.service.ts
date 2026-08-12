import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { EventBus } from '../events/event-bus';
import { AuditService } from '../audit/audit.service';
import { DmsTypeResolver } from '../../modules/documents/dms-type-resolver.service';
import type { DocumentType, RecurringFrequency } from '@prisma/client';

/**
 * F.5 — Recurring document templates.
 *
 * A RecurringDocument stores a template (partner, lines, journal mapping) plus
 * a frequency. The RecurringWorker (cron) generates a child document on each
 * `nextRunAt`, then advances the schedule. The user runs the resulting draft
 * through the normal document workflow (post → payment).
 */

const FREQUENCY_MS: Record<RecurringFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  quarterly: 90 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

export interface RecurringTemplateLine {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxId?: string;
  accountId?: string;
}

export interface RecurringTemplate {
  partnerId: string;
  currencyId?: string;
  exchangeRate?: number;
  reference?: string;
  notes?: string;
  lines: RecurringTemplateLine[];
}

@Injectable()
export class RecurringService {
  private readonly logger = new Logger('RecurringService');

  constructor(
      private readonly prisma: PrismaService,
      private readonly tenant: TenantContextService,
      private readonly events: EventBus,
      private readonly audit: AuditService,
      private readonly dmsTypes: DmsTypeResolver,
    ) {}

  create(params: {
    name: string;
    documentType: DocumentType;
    template: RecurringTemplate;
    frequency: RecurringFrequency;
    nextRunAt: Date;
    endDate?: Date;
  }) {
    return this.prisma.client.recurringDocument.create({
      data: {
        organizationId: this.tenant.organizationId,
        name: params.name,
        documentType: params.documentType,
        template: params.template as any,
        frequency: params.frequency,
        nextRunAt: params.nextRunAt,
        endDate: params.endDate ?? null,
        createdById: this.tenant.userId ?? null,
      },
    });
  }

  pause(id: string) {
    return this.prisma.client.recurringDocument.update({
      where: { id },
      data: { status: 'paused' },
    });
  }

  resume(id: string) {
    return this.prisma.client.recurringDocument.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  end(id: string) {
    return this.prisma.client.recurringDocument.update({
      where: { id },
      data: { status: 'ended' },
    });
  }

  list() {
    return this.prisma.client.recurringDocument.findMany({
      where: { organizationId: this.tenant.organizationId },
      orderBy: { nextRunAt: 'asc' },
    });
  }

  findOne(id: string) {
    return this.prisma.client.recurringDocument.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
    });
  }

  /** Tick the scheduler — generates children for due rows. Called by cron. */
  async tick(now: Date = new Date()): Promise<{ processed: number; errors: number }> {
    const due = await this.prisma.raw.recurringDocument.findMany({
      where: { status: 'active', nextRunAt: { lte: now } },
      take: 100,
    });
    let processed = 0;
    let errors = 0;
    for (const r of due) {
      try {
        await this.generateOne(r, now);
        processed++;
      } catch (err) {
        errors++;
        await this.prisma.raw.recurringDocumentRun.create({
          data: {
            organizationId: r.organizationId,
            recurringId: r.id,
            scheduledFor: r.nextRunAt,
            ranAt: now,
            status: 'failed',
            error: String(err).slice(0, 1000),
          },
        });
        this.logger.warn(`Recurring ${r.id} failed: ${String(err)}`);
      }
    }
    return { processed, errors };
  }

  private async generateOne(r: any, now: Date) {
    const template = r.template as RecurringTemplate;
    const orgId = r.organizationId as string;
    // Build a draft document for the recurring child. Caller is responsible
    // for posting it through the normal workflow.
    const doc = await this.prisma.raw.document.create({
      data: {
        organizationId: orgId,
        documentNumber: `DRAFT-${r.id.slice(0, 8)}-${r.lastRunAt?.getTime() ?? now.getTime()}`,
                documentType: r.documentType,
                documentTypeId: await this.dmsTypes.resolveIdByCode(r.documentType, this.prisma.raw),
                partnerId: template.partnerId,
        currencyId: template.currencyId ?? null,
        exchangeRate: template.exchangeRate ?? 1,
        issueDate: now,
        status: 'draft',
        reference: template.reference ?? `recurring:${r.name}`,
        notes: template.notes ?? null,
        sourceType: 'recurring',
        sourceId: r.id,
      },
    });
    let lineNo = 1;
    let subtotal = 0;
    const taxAmount = 0;
    for (const ln of template.lines ?? []) {
      const qty = Number(ln.quantity);
      const price = Number(ln.unitPrice);
      const lineSubtotal = +(qty * price * (1 - Number(ln.discountPercent ?? 0) / 100)).toFixed(6);
      // Tax computation is delegated to the canonical TaxCalculationService in
      // a follow-up — for now the recurring MVP writes subtotal + 0 tax and
      // the user adjusts in the draft before posting.
      await this.prisma.raw.documentLine.create({
        data: {
          organizationId: orgId,
          documentId: doc.id,
          productId: ln.productId ?? null,
          accountId: ln.accountId ?? null,
          description: ln.description,
          quantity: qty,
          unitPrice: price,
          discountPercent: ln.discountPercent ?? 0,
          taxId: ln.taxId ?? null,
          subtotal: lineSubtotal,
          taxAmount: 0,
          total: lineSubtotal,
          lineNumber: lineNo++,
        },
      });
      subtotal += lineSubtotal;
    }
    await this.prisma.raw.document.update({
      where: { id: doc.id },
      data: {
        subtotal,
        discountTotal: 0,
        taxAmount,
        totalAmount: subtotal,
        amountResidual: subtotal,
      },
    });
    await this.prisma.raw.recurringDocumentRun.create({
      data: {
        organizationId: orgId,
        recurringId: r.id,
        scheduledFor: r.nextRunAt,
        ranAt: now,
        documentId: doc.id,
        status: 'generated',
      },
    });
    // Advance schedule.
    const next = new Date(r.nextRunAt.getTime() + FREQUENCY_MS[r.frequency as RecurringFrequency]);
    const ended = r.endDate && next > r.endDate;
    await this.prisma.raw.recurringDocument.update({
      where: { id: r.id },
      data: {
        lastRunAt: now,
        nextRunAt: next,
        ...(ended ? { status: 'ended' } : {}),
      },
    });
    this.events.publish('recurring.generated' as any, {
      organizationId: orgId,
      recurringId: r.id,
      documentId: doc.id,
    });
    await this.audit.record({
      entity: 'RecurringDocument',
      entityId: r.id,
      action: 'update',
      newValues: { generatedDocumentId: doc.id },
    });
  }
}
