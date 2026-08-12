import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { EVENTS, type WorkflowDefinition, type WorkflowTransition } from '@erp/shared';
import { WorkflowRegistry } from '../../kernel/workflow/workflow.registry';

/**
 * Legacy → canonical status aliases (see order-status.util.ts). During the
 * Android wire-compat window an order row could still sit on a legacy value; a
 * transition that only declared the canonical `from` would throw at the till.
 * Every canonical transition is therefore mirrored onto its legacy sources.
 * Delete this together with the legacy enum values in the cleanup migration.
 */
const LEGACY_ALIASES: Record<string, string[]> = {
  confirmed: ['open'],
  in_progress: ['preparing', 'ready'],
  completed: ['served'],
};

/** Expand each transition with the legacy spellings of its `from` state. */
function withLegacyFromStates(transitions: WorkflowTransition[]): WorkflowTransition[] {
  const out: WorkflowTransition[] = [];
  for (const t of transitions) {
    out.push(t);
    for (const legacyFrom of LEGACY_ALIASES[t.from] ?? []) {
      out.push({ ...t, from: legacyFrom });
    }
  }
  return out;
}

/**
 * The POS `Order` state machine (ADR-007).
 *
 * `Order` is the operational document for EVERY vertical, so its lifecycle is
 * domain-neutral — kitchen states live on `KitchenTicket.status`, rental custody
 * on the rental lifecycle, and so on. Fulfillment-specific progress is reported
 * INTO this machine (`start_fulfillment` / `complete`), never modelled by it.
 *
 * **Permissions deliberately mirror the existing route guards on
 * `pos-orders.controller.ts` rather than tightening them.** The controller is
 * still the primary gate; declaring the same permission here is defence in
 * depth. Transitions driven internally (settlement closing an order, a merge or
 * table-split cancelling its source) carry NO permission, because their routes
 * are already gated on a different one (`tables:merge`, `tables:split`) and
 * requiring `pos:*` here would break those callers.
 */
@Injectable()
export class PosWorkflowsInitializer implements OnModuleInit {
  private readonly logger = new Logger('PosWorkflows');
  constructor(private readonly workflows: WorkflowRegistry) {}

  onModuleInit(): void {
    this.workflows.register(this.orderWorkflow());
    this.logger.log('POS workflows initialized (order + core invoice/payment workflows)');
  }

  private orderWorkflow(): WorkflowDefinition {
    /** An order that has been billed can no longer be cancelled or reopened. */
    const notBilled = (ctx: { entity?: unknown }) => !(ctx.entity as any)?.invoiceId;

    return {
      documentType: 'order',
      initial: 'draft',
      transitions: withLegacyFromStates([
        // ── Confirmation ────────────────────────────────────────────────────
        // POS creates orders directly at `confirmed`; `draft` becomes reachable
        // with the quotation chain (P5).
        { from: 'draft', to: 'confirmed', action: 'confirm', permission: 'pos:checkout', event: EVENTS.OrderConfirmed },

        // ── Fulfillment ─────────────────────────────────────────────────────
        // Raised by the first fulfillment activity (firing the kitchen today;
        // any registered fulfillment strategy once P4 lands).
        { from: 'confirmed', to: 'in_progress', action: 'start_fulfillment', permission: 'pos:checkout', event: EVENTS.OrderFulfillmentStarted },

        // ── Completion (billed, or all fulfillment done) ─────────────────────
        // Internal: raised by PosInvoiceService at bill generation. No
        // permission — the billing routes are already gated on `pos:checkout`,
        // and the rental/repair verticals bill through the same service under
        // their OWN permissions, which requiring `pos:checkout` here would break.
        { from: 'confirmed', to: 'completed', action: 'complete', event: EVENTS.OrderCompleted },
        { from: 'in_progress', to: 'completed', action: 'complete', event: EVENTS.OrderCompleted },

        // ── Settlement ──────────────────────────────────────────────────────
        // Internal: driven by PosInvoiceService once the invoice is settled, so
        // no permission (the settle route is already gated on pos:checkout).
        // `confirmed`/`in_progress` are reachable here because a credit or
        // written-off invoice can close an order that never passed `completed`.
        { from: 'completed', to: 'closed', action: 'close', event: EVENTS.OrderClosed },
        { from: 'confirmed', to: 'closed', action: 'close', event: EVENTS.OrderClosed },
        { from: 'in_progress', to: 'closed', action: 'close', event: EVENTS.OrderClosed },

        // ── Cancellation ────────────────────────────────────────────────────
        { from: 'draft', to: 'cancelled', action: 'cancel', permission: 'pos:checkout', guard: notBilled, event: EVENTS.OrderCancelled },
        { from: 'confirmed', to: 'cancelled', action: 'cancel', permission: 'pos:checkout', guard: notBilled, event: EVENTS.OrderCancelled },
        { from: 'in_progress', to: 'cancelled', action: 'cancel', permission: 'pos:checkout', guard: notBilled, event: EVENTS.OrderCancelled },

        // Internal cancellation: the source order of a merge or a table split is
        // retired. Gated by `tables:merge` / `tables:split` on the route.
        { from: 'confirmed', to: 'cancelled', action: 'supersede', guard: notBilled, event: EVENTS.OrderSuperseded },
        { from: 'in_progress', to: 'cancelled', action: 'supersede', guard: notBilled, event: EVENTS.OrderSuperseded },

        // ── Reopen ──────────────────────────────────────────────────────────
        { from: 'cancelled', to: 'confirmed', action: 'reopen', permission: 'pos:override', guard: notBilled, event: EVENTS.OrderReopened },
      ]),
    };
  }
}
