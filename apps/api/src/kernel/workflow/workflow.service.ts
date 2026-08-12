import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DomainEventName, WorkflowContext, WorkflowDefinition, WorkflowState, WorkflowTransition } from '@erp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { AuditService } from '../audit/audit.service';
import { EventOutboxService } from '../events/event-outbox.service';
import { WorkflowRegistry } from './workflow.registry';

/**
 * Generic state-machine executor (ADR-007).
 *
 * Every status transition (post, cancel, reverse, etc.) goes through here.
 * WorkflowService:
 *   1. Resolves the definition for `entityType`.
 *   2. Loads the current entity row (or accepts it via the payload).
 *   3. Looks up the matching transition `{from, action}`.
 *   4. Checks the actor has the required permission.
 *   5. Runs the guard (if any).
 *   6. Runs the side effect (if any) inside the DB transaction.
 *   7. Updates the entity's status, writes an AuditLog, and emits an event.
 *
 * Status updates and side effects run inside a single Prisma transaction so a
 * failed side effect rolls back the status change.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly outbox: EventOutboxService,
    private readonly registry: WorkflowRegistry,
  ) {}

  /** List the actions currently available to the actor on this entity. */
  availableActions(entityType: string, fromState: WorkflowState, permissions: string[]): WorkflowTransition[] {
    const def = this.registry.get(entityType);
    if (!def) return [];
    return def.transitions.filter(
      (t) => t.from === fromState && (!t.permission || permissions.includes(t.permission)),
    );
  }

  /** Cheap pre-flight: would this transition be allowed? (no DB write) */
  canTransition(
    entityType: string,
    fromState: WorkflowState,
    action: string,
    permissions: string[],
  ): WorkflowTransition | undefined {
    const def = this.registry.get(entityType);
    if (!def) return undefined;
    return def.transitions.find(
      (t) =>
        t.from === fromState &&
        t.action === action &&
        (!t.permission || permissions.includes(t.permission)),
    );
  }

  /**
   * Execute a transition. Pass `entity` to skip the DB lookup; otherwise the
   * service loads `entityType` row by id.
   *
   * Returns `{ fromState, toState, entity }` after the transition commits.
   */
  async transition<T = Record<string, unknown>>(params: {
    entityType: string;
    entityId: string;
    action: string;
    payload?: Record<string, unknown>;
    /** Pass the loaded entity to avoid a redundant query. */
    entity?: T;
    /** Use a custom loader (default: tx[entityType.toLowerCase()].findFirst). */
    loader?: (tx: any) => Promise<T | null>;
    /**
     * Run inside the caller's transaction instead of opening a new one.
     *
     * Required whenever the caller is already inside `$transaction`: without it
     * this method would start a nested transaction on a different connection,
     * which cannot see the caller's uncommitted rows and commits independently
     * of them. Mirrors `PosInvoiceService.generateInvoice(…, externalTx)`.
     */
    externalTx?: any;
  }): Promise<{ fromState: WorkflowState; toState: WorkflowState; entity: T }> {
    const def = this.registry.get(params.entityType);
    if (!def) throw new NotFoundException(`No workflow defined for entity type '${params.entityType}'`);

    const ctx: WorkflowContext = {
      entityType: params.entityType,
      entityId: params.entityId,
      organizationId: this.tenant.organizationId,
      userId: this.tenant.userId ?? null,
      permissions: this.tenant.permissions ?? [],
      action: params.action,
      fromState: 'draft', // filled in after we load the row
      toState: 'draft',
      payload: params.payload,
      entity: params.entity,
    };

    const run = async (tx: any) => {
      const entity = params.entity ?? (params.loader ? await params.loader(tx) : await this.defaultLoader(tx, params));
      if (!entity) throw new NotFoundException(`${params.entityType} ${params.entityId} not found`);
      ctx.entity = entity;
      ctx.fromState = (entity as any).status as WorkflowState;
      if (!ctx.fromState) {
        throw new BadRequestException(`Entity ${params.entityType} has no 'status' field`);
      }

      const transition = def.transitions.find((t) => t.from === ctx.fromState && t.action === params.action);
      if (!transition) {
        throw new BadRequestException(
          `No '${params.action}' transition from '${ctx.fromState}' for ${params.entityType}`,
        );
      }
      ctx.toState = transition.to;

      // Permission check.
      if (transition.permission && !ctx.permissions.includes(transition.permission)) {
        throw new ForbiddenException(
          `Missing permission '${transition.permission}' for ${params.entityType}.${params.action}`,
        );
      }

      // Guard.
      if (transition.guard) {
        const ok = await transition.guard(ctx);
        if (!ok) throw new BadRequestException(`Guard rejected ${params.entityType}.${params.action}`);
      }

      // Side effect (runs first, so a failed effect rolls back the status update).
      if (transition.sideEffect) {
        await transition.sideEffect(ctx, tx);
      }

      // Update status.
      await tx[this.modelName(params.entityType)].updateMany({
        where: { id: params.entityId },
        data: { status: transition.to, ...(this.statusExtraFields(params.entityType, transition.to)) },
      });

      await this.audit.recordInTx(tx, {
        entity: params.entityType,
        entityId: params.entityId,
        action: this.auditActionFor(params.action),
        oldValues: { status: ctx.fromState },
        newValues: { status: transition.to, action: params.action },
      });

      // Emit the business fact ON THE SAME TRANSACTION, so a rolled-back
      // transition can never leave an event behind claiming it happened. A
      // transition that declares `event` publishes that typed name and is
      // recorded in `DomainEventLog`; one that doesn't falls back to the
      // untyped `${entityType}.${action}` notification, which is delivered but
      // not recorded (no `EVENT_SUBJECT` entry).
      const eventName = transition.event ?? (`${params.entityType}.${params.action}` as DomainEventName);
      await this.outbox.publish(tx, eventName, {
        organizationId: ctx.organizationId,
        [`${params.entityType}Id`]: params.entityId,
        fromState: ctx.fromState,
        toState: transition.to,
        action: params.action,
        ...(params.payload ?? {}),
      } as never);

      return { fromState: ctx.fromState, toState: transition.to, entity: { ...(entity as object), status: transition.to } as T };
    };

    // Reuse the caller's transaction when supplied, otherwise own one.
    return params.externalTx ? run(params.externalTx) : this.prisma.client.$transaction(run);
  }

  private async defaultLoader(tx: any, params: { entityType: string; entityId: string }) {
    const model = this.modelName(params.entityType);
    return tx[model].findFirst({ where: { id: params.entityId } });
  }

  /** Map a workflow entityType to a Prisma model name (camelCase lowercase). */
  private modelName(entityType: string): string {
    // 'invoice' -> 'document', 'vendor_bill' -> 'document', 'journal_entry' -> 'journalEntry',
    // 'partner' -> 'partner', 'product' -> 'product', 'payment' -> 'payment'.
    // We keep a small explicit map for the ambiguous ones; everything else is pascal->camel.
    const map: Record<string, string> = {
      invoice: 'document',
      credit_note: 'document',
      vendor_bill: 'document',
      debit_note: 'document',
      proforma_invoice: 'document',
      journal_entry: 'journalEntry',
    };
    if (map[entityType]) return map[entityType];
    // snake_case -> camelCase (first letter lower).
    return entityType.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  /** Extra fields to set on status transitions (e.g. `postedAt`, `postedBy`). */
  private statusExtraFields(entityType: string, toState: WorkflowState): Record<string, unknown> {
    if (toState === 'posted') {
      return { postedAt: new Date(), postedBy: this.tenant.userId ?? null };
    }
    if (toState === 'cancelled') {
      return { cancelledAt: new Date(), cancelledBy: this.tenant.userId ?? null };
    }
    return {};
  }

  private auditActionFor(action: string): 'create' | 'update' | 'delete' | 'login' | 'logout' | 'approve' | 'reject' | 'post' | 'cancel' | 'receive' | 'issue' | 'adjust' | 'transfer' {
    if (action === 'post') return 'post';
    if (action === 'cancel') return 'cancel';
    if (action === 'void') return 'cancel';
    if (action === 'approve') return 'approve';
    if (action === 'reject') return 'reject';
    return 'update';
  }
}