/**
 * Meals V2 — term meal-plan billing.
 *
 * For each active `term_plan` assignment in a term, raise ONE posted AR invoice
 * (`Document`, sourceType='school_meal') from the plan's fee Product +
 * pricePerTerm, exactly like tuition. Create + line build + GL post +
 * promote-to-posted run in ONE `$transaction`, so a crash can never leave an
 * orphaned unposted invoice.
 * Idempotent on (org, sourceType, sourceId, reference) + the GL postingKey.
 */
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { EVENTS } from '@erp/shared';
import type { GenerateMealChargesDto } from './dto.types';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

@Injectable()
export class MealBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly documentBuilder: DocumentBuilderService,
    private readonly posting: PostingService,
    private readonly placements: PlacementLookupService,
  ) {}

  async generateMealChargesForTerm(dto: GenerateMealChargesDto) {
    const organizationId = this.tenant.organizationId;

    const assignments = await this.prisma.client.mealPlanAssignment.findMany({
      where: {
        termId: dto.termId,
        status: 'active',
        mealPlan: { billingModel: 'term_plan' },
        ...(dto.classId
          ? { studentProfile: this.placements.studentWhere({ classIds: [dto.classId] }) }
          : {}),
      },
      include: { mealPlan: true, studentProfile: { include: { partner: true } } },
    });
    if (assignments.length === 0) throw new BadRequestException('No active term-plan meal assignments for this term');

    const reference = `MEALS-${dto.termId}`;
    const created: any[] = [];
    const skipped: any[] = [];

    for (const a of assignments) {
      const plan = a.mealPlan;
      const partnerId = a.studentProfile?.partnerId;
      if (!partnerId) { skipped.push({ assignmentId: a.id, reason: 'no_partner' }); continue; }
      if (!plan.feeProductId) { skipped.push({ assignmentId: a.id, reason: 'plan_has_no_fee_product' }); continue; }
      const price = Number(plan.pricePerTerm);
      if (price <= 0) { skipped.push({ assignmentId: a.id, reason: 'zero_price' }); continue; }

      // sourceId is per-assignment so re-runs dedup and invoices trace back.
      const sourceId = a.id;
      const issueDate = new Date();

      try {
        const doc = await this.prisma.client.$transaction(async (tx: any) => {
          const existing = await tx.document.findFirst({
            where: { organizationId, sourceType: 'school_meal', sourceId, reference },
          });
          if (existing) return { _skipped: true, id: existing.id };

          const createdDoc = await this.documentBuilder.createDocument(
            tx,
            'sales_invoice',
            {
              partnerId,
              issueDate: issueDate.toISOString(),
              reference,
              notes: `Term meal plan: ${plan.name}`,
              sourceType: 'school_meal',
            },
            [{ productId: plan.feeProductId!, description: `Meals · ${plan.name}`, quantity: 1, unitPrice: price }],
          );
          await tx.document.update({ where: { id: createdDoc.id }, data: { sourceId } });

          const full = await tx.document.findFirst({ where: { id: createdDoc.id }, include: { lines: true, partner: true } });
          const journalLines = await this.documentBuilder.salesPostingLines(tx, full, {
            receivable: `Meal invoice ${full.documentNumber}`,
            revenue: 'Meal revenue',
          });

          const entry = await this.posting.post(
            {
              journalCode: 'SALES',
              date: issueDate,
              description: `School meals · ${full.documentNumber}`,
              sourceType: 'school_meal_invoice',
              sourceId: full.id,
              postingKey: `school_meal:${full.id}`,
              lines: journalLines,
            },
            tx,
          );

          return tx.document.update({
            where: { id: full.id },
            data: {
              amountResidual: full.totalAmount,
              amountPaid: 0,
              paymentStatus: 'not_paid',
              status: 'posted',
              journalEntryId: entry.id,
              postedAt: new Date(),
            },
            include: { lines: true, partner: true },
          });
        });

        if ((doc as any)._skipped) {
          skipped.push({ assignmentId: a.id, documentId: (doc as any).id, reason: 'already_billed' });
          continue;
        }
        created.push(doc);
        this.events.publish(EVENTS.SchoolMealChargePosted, {
          organizationId,
          documentId: doc.id,
          studentProfileId: a.studentProfileId,
          amount: doc.totalAmount.toString(),
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          skipped.push({ assignmentId: a.id, reason: 'already_billed' });
          continue;
        }
        throw err;
      }
    }

    return { count: created.length, documents: created, skipped };
  }
}
