import type { DomainEventName } from './events';

/**
 * Canonical *document* lifecycle states (ADR-007) — the shared vocabulary for
 * invoices, bills, payments and journal entries.
 *
 * This list is NOT exhaustive of every workflow state in the platform. Domain
 * aggregates register their own vocabularies with the same engine: an `Order`
 * runs draft → confirmed → in_progress → completed → closed, a rental unit runs
 * a custody lifecycle, and so on. {@link WorkflowState} is therefore `string`,
 * with these values kept as literals purely for editor autocomplete.
 */
export const WORKFLOW_STATES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'posted',
  'paid',
  'cancelled',
  'closed',
  'reversed',
  'archived',
  'active',
  'inactive',
] as const;
/** A canonical document state — narrow, for the shared document workflows. */
export type CanonicalWorkflowState = (typeof WORKFLOW_STATES)[number];

/**
 * Any workflow state. Open by design: a module may register a definition over
 * its own vocabulary (see {@link WORKFLOW_STATES}). The union with `string & {}`
 * keeps autocomplete on the canonical values without closing the type.
 */
export type WorkflowState = CanonicalWorkflowState | (string & {});

/** Auditable actions (ADR-006). */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'approve',
  'reject',
  'post',
  'cancel',
  'receive',
  'issue',
  'adjust',
  'transfer',
  'reconcile',
  'reprint',
  'assign',
  'unassign',
  'restore',
  'measure',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  action: string;
  /** resource:action permission required to perform this transition. */
  permission?: string;
  /** Optional sync guard — must return truthy for the transition to proceed. */
  guard?: (ctx: WorkflowContext) => boolean | Promise<boolean>;
  /**
   * Optional sync side effect to run inside the same DB transaction as the
   * status update. Use for "post" transitions (GL effects) — let the registry
   * compose them.
   */
  sideEffect?: (ctx: WorkflowContext, tx: any) => void | Promise<void>;
  /**
   * The typed business event this transition emits, e.g. `order.completed`.
   *
   * Declare it and the engine publishes that name atomically with the status
   * update, so the fact lands in `DomainEventLog` and can be projected into a
   * milestone. Omit it and the engine falls back to an untyped
   * `${entityType}.${action}` notification, which reaches the outbox but is NOT
   * recorded as a fact — fine for transitions nothing needs to remember.
   */
  event?: DomainEventName;
}

/** Runtime context passed to guards/side effects (ADR-007). */
export interface WorkflowContext {
  entityType: string;
  entityId: string;
  organizationId: string;
  userId?: string | null;
  permissions: string[];
  action: string;
  fromState: WorkflowState;
  toState: WorkflowState;
  /** Free-form payload (transition-specific args, e.g. cancellation reason). */
  payload?: Record<string, unknown>;
  /** The current entity row (the loader fills this). */
  entity?: unknown;
}

export interface WorkflowDefinition {
  /** Entity type key, e.g. "invoice", "purchase_order". */
  documentType: string;
  initial: WorkflowState;
  transitions: WorkflowTransition[];
}
