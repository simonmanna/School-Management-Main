/** Canonical document lifecycle states reused by every future document (ADR-007).
 * Note: `WorkflowState` is intentionally widened to `string` so verticals (e.g.
 * School) can introduce domain-specific states (e.g. `under_review`, `exam_scheduled`,
 * `enrolled`, `scheduled`, `published`, `closed`) without forking the engine. The
 * `WORKFLOW_STATES` array remains a set of common states the engine recognises
 * for built-in transitions; `toStateExtraFields` still reacts only to those.
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
export type WorkflowState = string;

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
