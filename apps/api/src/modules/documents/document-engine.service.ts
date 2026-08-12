/**
 * DMS — Phase 2 lifecycle engine.
 *
 * One generic command executor over the declarative registry:
 *
 *   DocumentAction-first idempotency (G6): a retry with the same
 *   (documentId, action, Idempotency-Key) replays the stored result instead
 *   of re-executing side effects. A concurrent duplicate races into the
 *   compound unique index and is converted to a replay on P2002.
 *
 *   Version-guarded write (G7): every mutation is
 *   `UPDATE ... WHERE version = N → version = N+1`; a stale actor gets 409.
 *
 *   Transactional record: status flip + numbering + counter-part row +
 *   DocumentAction + Audit + outbox event all commit atomically.
 *
 * Ownership boundary (§1.2): the engine owns document identity, state and
 * representation. Posting/reversal *effects* are domain-owned — the engine
 * emits `document.<action>` facts and creates the reversal counterpart row;
 * subscribed domain hooks push them through accounting/inventory.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DocumentStatus, DocumentType, Prisma } from '@prisma/client';
import type { AuditAction, DomainEventName } from '@erp/shared';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventOutboxService } from '../../kernel/events/event-outbox.service';
import { DocumentPermissionsService, toPermissionSubject } from './document-permissions.service';
import {
  cancelEligibility,
  composeSequenceKey,
  composeSequencePrefix,
  evaluateGuards,
  findTransition,
  isReversal,
  reversalEligibility,
  shouldCaptureSnapshot,
  validateAmendData,
} from './dms.lifecycle';
import type { TransitionRow } from './dms.lifecycle';
import { DMS_REVERSAL_COUNTERPARTS, DMS_REISSUE_COUNTERPARTS, DRAFT_NUMBER_PREFIX } from './dms.types';
import { buildSnapshotData, sealSnapshot } from './dms.snapshot';

/** Map engine actions onto the fixed AUDIT_ACTIONS vocabulary (ADR-006). */
const AUDIT_ACTION_BY_ENGINE_ACTION: Record<string, string> = {
  submit: 'update',
  approve: 'approve',
  reject: 'reject',
  confirm: 'update',
  issue: 'issue',
  activate: 'update',
  expire: 'update',
  revoke: 'update',
  post: 'post',
  pay: 'update',
  close: 'update',
  cancel: 'cancel',
  reverse: 'cancel',
  reissue: 'post',
  terminate: 'update',
  archive: 'update',
  amend: 'update',
};

/**
 * Engine action → declared domain event name. The vocabulary in @erp/shared
 * (EVENTS/DomainEventMap/EVENT_SUBJECT) uses past-tense fact names, so the
 * ledger record is keyed by the DECLARED name, not by the raw action string.
 */
const DOMAIN_EVENT_BY_ENGINE_ACTION: Record<string, string> = {
  submit: 'document.submitted',
  approve: 'document.approved',
  reject: 'document.rejected',
  confirm: 'document.confirmed',
  issue: 'document.issued',
  activate: 'document.activated',
  expire: 'document.expired',
  revoke: 'document.revoked',
  post: 'document.posted',
  pay: 'document.paid',
  close: 'document.closed',
  cancel: 'document.cancelled',
  reverse: 'document.reversed',
  reissue: 'document.reissued',
  terminate: 'document.terminated',
  archive: 'document.archived',
  amend: 'document.amended',
};

export interface EngineActionInput {
  orgId: string;
  userId: string;
  userPermissions: string[];
  documentId: string;
  action: string;
  idempotencyKey: string;
  reason?: string;
  note?: string;
  /** amend payload (§5.3) — document-owned content keys only. */
  data?: Record<string, unknown>;
}

export interface EngineActionResult {
  replayed: boolean;
  action: string;
  fromStatus: string;
  toStatus: string;
  version: number;
  documentNumber: string;
  numberingApplied: boolean;
  counterpartId?: string | null;
  snapshotId?: string | null;
  amended?: boolean;
  at: string;
}

@Injectable()
export class DocumentEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly permissions: DocumentPermissionsService,
    private readonly audit: AuditService,
    private readonly outbox: EventOutboxService,
  ) {}

  /** Execute a lifecycle action with idempotency + optimistic locking. */
  async runAction(input: EngineActionInput): Promise<EngineActionResult> {
    if (!input.idempotencyKey?.trim()) {
      throw new BadRequestException('idempotencyKey is required');
    }
    const idempotencyKey = input.idempotencyKey.trim();

    // Load the document with its full registry shape (outside the tx — the
    // tx is reserved for the guarded write + record rows).
    const doc = await this.prisma.client.document.findFirst({
      where: { id: input.documentId, organizationId: input.orgId },
      include: {
        documentTypeDef: { include: { lifecycle: { include: { transitions: true } } } },
      },
    });
    if (!doc) throw new NotFoundException('Document not found');

    // Idempotency fast path — a retry with the same (documentId, action, key)
    // replays the stored result without touching the current state (G6). The
    // concurrent race is caught by the compound unique index → P2002 → replay
    // in the catch below.
    const prior = await this.prisma.client.documentAction.findUnique({
      where: {
        organizationId_documentId_action_idempotencyKey: {
          organizationId: input.orgId,
          documentId: doc.id,
          action: input.action,
          idempotencyKey,
        },
      },
    });
    if (prior) {
      if (prior.status === 'failed') {
        throw new BadRequestException(prior.error ?? 'Replayed a failed action (no-op)');
      }
      if (prior.result) {
        return { ...(prior.result as unknown as EngineActionResult), replayed: true };
      }
    }

    const def = doc.documentTypeDef;
    if (!def.lifecycle) {
      throw new BadRequestException(`Document type '${def.code}' has no lifecycle registered`);
    }

    // §5.3 — `amend` is a transition-less, content-only action for VERSIONED
    // types: same idempotency/version/audit/event skeleton, but no status
    // change and no transition lookup (registry stays untouched).
    let mergedAmend: { mergedData: Record<string, unknown>; notes?: string | null } | null = null;
    if (input.action === 'amend') {
      if (def.editPolicy !== 'VERSIONED') {
        throw new BadRequestException(
          `amend is only allowed for VERSIONED document types ('${def.code}' is ${def.editPolicy})`,
        );
      }
      const verdict = validateAmendData((doc.data as Record<string, unknown> | null) ?? null, input.data);
      if (!verdict.ok) throw new BadRequestException(verdict.reason);
      mergedAmend = verdict;
    }

    const transition = findTransition(
      def.lifecycle.transitions as unknown as TransitionRow[],
      doc.status,
      input.action,
    );
    if (input.action !== 'amend' && input.action !== 'reissue' && !transition) {
      throw new BadRequestException(
        `Action '${input.action}' is not allowed from status '${doc.status}'`,
      );
    }

    // Permission: doc:<type>:<action> → doc:<category>:<action> → doc:<action>.
    const effectiveKey = this.permissions.resolveKey(
      input.userPermissions,
      toPermissionSubject(def),
      input.action,
    );
    if (!effectiveKey) {
      throw new ForbiddenException(`Missing permission for document action '${input.action}'`);
    }

    // Idempotency guard (inside the tx so the replay read is atomic with any
    // concurrent execution of the same key).
    return this.prisma.client.$transaction(async (tx) => {
      const prior = await tx.documentAction.findUnique({
        where: {
          organizationId_documentId_action_idempotencyKey: {
            organizationId: input.orgId,
            documentId: doc.id,
            action: input.action,
            idempotencyKey,
          },
        },
      });
      if (prior) {
        if (prior.status === 'failed') {
          throw new BadRequestException(prior.error ?? 'Replayed a failed action (no-op)');
        }
        if (prior.result) {
          return { ...(prior.result as unknown as EngineActionResult), replayed: true };
        }
      }

      // --- Declarative guards (G4) ------------------------------------------
      const hasEffects = doc.journalEntryId != null;
      const blocked =
        input.action === 'amend' || input.action === 'reissue'
          ? []
          : evaluateGuards(
              ((transition as TransitionRow).guardJson as Prisma.JsonObject | undefined) ?? null,
              {
          reason: input.reason,
          isPaid: doc.status === 'paid' || doc.paymentStatus === 'paid',
          hasApprovedRequest: await this.hasApprovedApproval(
            tx,
            input.orgId,
            def.code,
            doc.id,
          ),
          hasSnapshot: (await tx.documentSnapshot.count({ where: { documentId: doc.id } })) > 0, // Phase 4 — real check
        },
      );
      if (blocked.length) {
        throw new UnprocessableEntityException(blocked.join('; '));
      }

      // --- Cancel vs reverse (§3.6) ----------------------------------------
      if (input.action === 'cancel') {
        const eligibility = cancelEligibility(hasEffects);
        if (!eligibility.allowed) throw new BadRequestException(eligibility.reason);
      }
      const counterpartCode = DMS_REVERSAL_COUNTERPARTS[def.code] ?? null;
      if (input.action === 'reverse') {
        const eligibility = reversalEligibility(hasEffects, counterpartCode);
        if (!eligibility.allowed) throw new BadRequestException(eligibility.reason);
        // Once a reversal exists the original is closed for further reversals
        // (§3.6 one-shot; reversal-of-reversal arrives with Phase 6 hooks).
        const alreadyReversed =
          doc.reversedDocumentId != null ||
          (await tx.document.count({
            where: { organizationId: input.orgId, reversedDocumentId: doc.id },
          })) > 0;
        if (alreadyReversed) {
          throw new BadRequestException('Document has already been reversed');
        }
      }

      // Phase 6: reissue is only applicable to a doc that was reversed. A reversal
// sets reversedDocumentId on the COUNTERPART (pointing back to the original),
// so we detect eligibility by looking for any doc reversedDocumentId → this doc.
      const hasReversal = input.action === 'reissue' && (await tx.document.count({
        where: { organizationId: input.orgId, reversedDocumentId: doc.id },
      })) > 0;
      if (input.action === 'reissue' && !hasReversal) {
        throw new BadRequestException('Document has not been reversed — reissue is not applicable');
      }

      // --- Phase 6: reissue (reversal-of-reversal) ---------------------------
      // Reissue targets a doc that was itself reversed (doc.reversedDocumentId
      // set by a prior reverse). It re-opens the original: flips status back to
      // posted, clears the reversal link, and creates a fresh counterpart + a
      // REISSUES relation from the original back to its prior reversal.
      let reissueCounterpartId: string | null = null;
      if (input.action === 'reissue') {
        const reissueCode = DMS_REISSUE_COUNTERPARTS[def.code] ?? null;
        if (!reissueCode) {
          throw new BadRequestException(
            `Type '${def.code}' has no reissue counterpart configured (Phase 6)`,
          );
        }
        reissueCounterpartId = await this.createCounterpart(tx, doc, def, reissueCode, input.userId);
        // Phase 6 — REISSUES mirror: original → counterpart.
        const reissuesType = await tx.documentRelationType.findUnique({ where: { code: 'REISSUES' } });
        if (reissuesType) {
          await tx.documentRelation.create({
            data: {
              organizationId: input.orgId,
              fromDocumentId: doc.id,
              toDocumentId: reissueCounterpartId,
              relationTypeId: reissuesType.id,
              payload: { reversedDocumentId: doc.reversedDocumentId, engine: true } as Prisma.InputJsonValue,
              createdById: input.userId,
            },
          });
        }
      }

      // --- Numbering (Phase 2.3): only placeholder/empty numbers -----------
      const year = new Date().getFullYear();
      let documentNumber = doc.documentNumber;
      let numberingApplied = false;
      if (
        def.numberingKey &&
        (!documentNumber || documentNumber.startsWith(DRAFT_NUMBER_PREFIX))
      ) {
        documentNumber = await this.sequence.next(
          composeSequenceKey(def.numberingKey, year),
          {
            prefix: composeSequencePrefix(def.numberingPrefix ?? undefined, year),
            padding: def.numberingPadding ?? 5,
          },
          tx,
        );
        numberingApplied = true;
      }

      // --- Version-guarded state write (G7) --------------------------------
          const toStatus = transition ? transition.toState : doc.status;
          const now = new Date();
          const data: Prisma.DocumentUpdateManyMutationInput = {
            status: toStatus as DocumentStatus,
            version: { increment: 1 },
            updatedBy: input.userId,
          };
          if (numberingApplied) data.documentNumber = documentNumber;
          if (input.action !== 'amend' && (toStatus === 'posted' || input.action === 'post')) {
            data.postedAt = now;
            data.postedBy = input.userId;
          }
          // §5.3 — content-only merge into Document.data + notes column.
          if (input.action === 'amend' && mergedAmend) {
            data.data = mergedAmend.mergedData as Prisma.InputJsonValue;
            if (mergedAmend.notes !== undefined) data.notes = mergedAmend.notes;
          }

      const updated = await tx.document.updateMany({
        where: { id: doc.id, organizationId: input.orgId, version: doc.version },
        data,
      });
      if (updated.count === 0) {
        throw new ConflictException(
          `Document was modified concurrently (expected version ${doc.version}); reload and retry`,
        );
      }

      // --- Reversal counterpart row (identity owned by the DMS; effects by
          //     the domain posting hooks) ----------------------------------------
          let counterpartId: string | null = null;
          if (input.action === 'reverse' && counterpartCode) {
            counterpartId = await this.createCounterpart(tx, doc, def, counterpartCode, input.userId);

            // §5.2 — CANCELS relation mirroring reversedDocumentId (from original →
            // counterpart). The engine owns both writes so they stay in sync.
            const cancelsType = await tx.documentRelationType.findUnique({ where: { code: 'CANCELS' } });
            if (cancelsType) {
              const existingRel = await tx.documentRelation.findFirst({
                where: {
                  organizationId: input.orgId,
                  fromDocumentId: doc.id,
                  toDocumentId: counterpartId,
                  relationTypeId: cancelsType.id,
                },
              });
              if (!existingRel) {
                await tx.documentRelation.create({
                  data: {
                    organizationId: input.orgId,
                    fromDocumentId: doc.id,
                    toDocumentId: counterpartId!,
                    relationTypeId: cancelsType.id,
                    payload: { reversedDocumentId: doc.id, engine: true } as Prisma.InputJsonValue,
                    createdById: input.userId,
                  },
                });
              }
            }
          }

          // --- Phase 4 snapshots: capture on issue/post/amend per policy, and
          //     ALWAYS on reverse (§3.6 "capture snapshot of the reversal"). ------
          let snapshotId: string | null = null;
          const captureOn = ((def.snapshotPolicy ?? {}) as { captureOn?: Array<'issue' | 'post' | 'amend'> })
            .captureOn;
          if (shouldCaptureSnapshot(captureOn, input.action, toStatus)) {
            snapshotId = await this.captureSnapshot(tx, doc, def, {
              documentNumber,
              status: toStatus,
              reason: input.action === 'reverse' ? 'reverse' : input.action,
              createdById: input.userId,
            });
          }

          // §5.3 — amendment history row (VERSIONED types only, content-only).
          if (input.action === 'amend' && mergedAmend) {
            await tx.documentVersion.create({
              data: {
                organizationId: input.orgId,
                documentId: doc.id,
                versionNo: doc.version + 1,
                data: mergedAmend.mergedData as Prisma.InputJsonValue,
                changeNote: input.note ?? null,
                changedById: input.userId,
              },
            });
          }

      // --- Transactional record ---------------------------------------------
      const result: EngineActionResult = {
        replayed: false,
        action: input.action,
        fromStatus: doc.status,
        toStatus,
        version: doc.version + 1,
        documentNumber,
        numberingApplied,
        counterpartId: counterpartId ?? reissueCounterpartId,
        snapshotId,
        amended: input.action === 'amend',
        at: now.toISOString(),
      };
      await tx.documentAction.create({
        data: {
          organizationId: input.orgId,
          documentId: doc.id,
          action: input.action,
          idempotencyKey,
          requestedById: input.userId,
          status: 'completed',
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Document',
        entityId: doc.id,
        action: (AUDIT_ACTION_BY_ENGINE_ACTION[input.action] ?? 'update') as AuditAction,
        oldValues: { documentAction: input.action, status: doc.status, version: doc.version },
        newValues: {
          documentAction: input.action,
          status: toStatus,
          version: doc.version + 1,
          documentNumber,
          numberingApplied,
          counterpartId: counterpartId ?? reissueCounterpartId,
        },
      });

      // Posting/reversal orchestration fact (declared business event — written
      // in this same tx so a rollback takes the fact with it).
      const eventName = DOMAIN_EVENT_BY_ENGINE_ACTION[input.action];
      if (!eventName) {
        throw new Error(`No declared domain event for engine action '${input.action}'`);
      }
      await this.outbox.publish(
        tx,
        eventName as DomainEventName,
        {
          organizationId: input.orgId,
          documentId: doc.id,
          documentNumber,
          documentTypeId: def.id,
          documentTypeCode: def.code,
          action: input.action,
          fromStatus: doc.status,
          toStatus,
          actorId: input.userId,
          version: doc.version + 1,
          reason: input.reason,
          counterpartId: counterpartId ?? reissueCounterpartId,
          note: input.note,
        } as never,
      );

      return result;
    }).catch((err) => {
      // Concurrent duplicate of the same idempotency key: the unique index won
      // the race. Re-read the winner and replay its result.
      if (this.isUniqueViolation(err)) {
        return this.replayDuplicate(input, doc.id);
      }
      throw err;
    });
  }

  /** Create the reversal counterpart (§3.6): credit note for invoices, debit
   *  note for vendor bills. Header mirrored, money fields negated. */
  private async createCounterpart(
    tx: Prisma.TransactionClient,
    doc: {
      id: string;
      organizationId: string;
      documentNumber: string;
      partnerId: string;
      currencyId: string | null;
      exchangeRate: Prisma.Decimal | string | number;
      issueDate: Date;
      dueDate: Date | null;
      sourceType: string | null;
      sourceId: string | null;
      branchId: string | null;
      subtotal: Prisma.Decimal | string | number;
      discountTotal: Prisma.Decimal | string | number;
      taxAmount: Prisma.Decimal | string | number;
      totalAmount: Prisma.Decimal | string | number;
      amountPaid: Prisma.Decimal | string | number;
      amountResidual: Prisma.Decimal | string | number;
      lines?: Array<{
        productId: string | null;
        menuItemId: string | null;
        accountId: string | null;
        description: string;
        quantity: Prisma.Decimal | string | number;
        unitPrice: Prisma.Decimal | string | number;
        discountPercent: Prisma.Decimal | string | number;
        taxId: string | null;
        taxAmount: Prisma.Decimal | string | number;
        subtotal: Prisma.Decimal | string | number;
        total: Prisma.Decimal | string | number;
        lineNumber: number;
        lineType: string;
        taxInclusive: boolean;
      }>;
    },
    def: { code: string; numberingKey: string | null; numberingPrefix: string | null; numberingPadding: number | null },
    counterpartCode: string,
    userId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const counterpartDef = await tx.documentTypeDef.findFirst({
      where: { code: counterpartCode },
    });
    if (!counterpartDef) throw new BadRequestException(`Counterpart type '${counterpartCode}' not registered`);

    const number = await this.sequence.next(
      composeSequenceKey(counterpartDef.numberingKey ?? counterpartCode, year),
      {
        prefix: composeSequencePrefix(counterpartDef.numberingPrefix ?? undefined, year),
        padding: counterpartDef.numberingPadding ?? 5,
      },
      tx,
    );

    const neg = (v: Prisma.Decimal | string | number): string =>
      `-${Number(v)}`; // Prisma accepts string for Decimal columns

    const now = new Date();
    const lines = (doc.lines ?? []).map((l) => ({
      organizationId: doc.organizationId,
      productId: l.productId,
      menuItemId: l.menuItemId,
      accountId: l.accountId,
      description: l.description,
      quantity: neg(l.quantity),
      unitPrice: neg(l.unitPrice),
      discountPercent: l.discountPercent, // percent is not money — untouched
      taxId: l.taxId,
      subtotal: neg(l.subtotal),
      taxAmount: neg(l.taxAmount),
      total: neg(l.total),
      lineNumber: l.lineNumber,
      lineType: l.lineType,
      taxInclusive: l.taxInclusive,
    }));

    const counterpart = await tx.document.create({
      data: {
        organizationId: doc.organizationId,
        documentNumber: number,
        documentType: counterpartCode as DocumentType,
        documentTypeId: counterpartDef.id,
        partnerId: doc.partnerId,
        currencyId: doc.currencyId,
        exchangeRate: doc.exchangeRate,
        issueDate: now,
        dueDate: doc.dueDate,
        sourceDocument: doc.documentNumber,
        status: 'posted',
        subtotal: neg(doc.subtotal),
        discountTotal: neg(doc.discountTotal),
        taxAmount: neg(doc.taxAmount),
        totalAmount: neg(doc.totalAmount),
        amountPaid: '0',
        // Residual mirrors the reversed amount; AR settlement hooks adjust it.
        amountResidual: Number(doc.amountResidual) > 0 ? neg(doc.amountResidual) : neg(doc.totalAmount),
        reversedDocumentId: doc.id,
        sourceType: doc.sourceType,
        sourceId: doc.sourceId,
        branchId: doc.branchId,
        postedAt: now,
        createdBy: userId,
        lines: { create: lines },
      },
    });

    // §4.4 — the reversal counterpart is a posted document with its own
    // snapshot policy; capture so it prints reproducibly too.
    const cpPolicy = (counterpartDef.snapshotPolicy ?? {}) as {
      captureOn?: Array<'issue' | 'post' | 'amend'>;
    };
    if (shouldCaptureSnapshot(cpPolicy.captureOn, 'post', 'posted')) {
      await this.captureSnapshot(
        tx,
        counterpart as never,
        { code: counterpartDef.code, name: counterpartDef.name },
        {
          documentNumber: counterpart.documentNumber,
          status: 'posted',
          reason: 'reverse',
          createdById: userId,
        },
      );
    }

    return counterpart.id;
  }

  /**
   * §4.4 snapshot capture — assembled ONLY from Document + DocumentLine +
   * registry label (§3.7) inside the same tx as the state write, sealed with
   * sha256(canonical(data) + templateVersionId). The seal makes post-issue
   * renders byte-reproducible regardless of later domain-state changes.
   */
  private async captureSnapshot(
    tx: Prisma.TransactionClient,
    doc: { organizationId: string; id: string } & Record<string, unknown>,
    def: { code: string; name: string },
    opts: { documentNumber: string; status: string; reason: string; createdById?: string },
  ): Promise<string> {
    const lines = await tx.documentLine.findMany({
      where: { documentId: (doc as { id: string }).id },
      orderBy: { lineNumber: 'asc' },
    });
    const a4 = await tx.templateDefinition.findFirst({
      where: { documentTypeId: (doc.documentTypeId as string) ?? undefined, format: 'a4', isActive: true },
    });
    const data = buildSnapshotData(doc as never, lines, { code: def.code, name: def.name });
    const seal = sealSnapshot(data, a4?.id ?? null);
    const row = await tx.documentSnapshot.create({
      data: {
        organizationId: (doc as { organizationId: string }).organizationId,
        documentId: (doc as { id: string }).id,
        state: opts.status,
        data: data as unknown as Prisma.InputJsonValue,
        templateVersionId: a4?.id ?? null,
        seal,
        reason: opts.reason,
        createdById: opts.createdById ?? null,
      },
    });
    return row.id;
  }

  private async hasApprovedApproval(
    tx: Prisma.TransactionClient,
    orgId: string,
    typeCode: string,
    documentId: string,
  ): Promise<boolean> {
    const req = await tx.approvalRequest.findFirst({
      where: {
        organizationId: orgId,
        entityType: `document:${typeCode}`,
        entityId: documentId,
        status: 'approved',
      },
    });
    return req != null;
  }

  /** Detach the duplicate-winner row and replay it. */
  private async replayDuplicate(
    input: EngineActionInput,
    documentId: string,
  ): Promise<EngineActionResult> {
    const winner = await this.prisma.client.documentAction.findUnique({
      where: {
        organizationId_documentId_action_idempotencyKey: {
          organizationId: input.orgId,
          documentId,
          action: input.action,
          idempotencyKey: input.idempotencyKey.trim(),
        },
      },
    });
    if (winner && winner.status === 'completed' && winner.result) {
      return {
        ...(winner.result as unknown as EngineActionResult),
        replayed: true,
      };
    }
    throw new ConflictException('A concurrent action with this Idempotency-Key is in progress; retry');
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002' &&
      String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('idempotency')
    );
  }
}