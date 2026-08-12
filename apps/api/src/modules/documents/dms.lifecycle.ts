/**
 * DMS — pure lifecycle decision logic (Phase 2 engine).
 *
 * Everything here is side-effect free so the engine's decision rules can be
 * unit-tested without a database (G4: declarative guards only — no scripting).
 * The engine wires these into the transactional write path.
 */
import type { GuardJson } from './dms.types';
import { AMENDABLE_FIELDS } from './dms.types';

export interface TransitionRow {
  fromState: string;
  toState: string;
  action: string;
  guardJson?: GuardJson | null;
}

export interface GuardEvalContext {
  /** Reason supplied by the caller (required when guard.requiresReason). */
  reason?: string;
  /** Document is fully paid (paymentStatus = paid / status = paid). */
  isPaid: boolean;
  /** An approved ApprovalRequest exists for (document:<code>, documentId). */
  hasApprovedRequest: boolean;
  /** A snapshot exists for the document (Phase 4 wire-in; false until then). */
  hasSnapshot: boolean;
}

/** Find the transition allowed for (fromState, action), or null. */
export function findTransition(
  transitions: TransitionRow[],
  fromState: string,
  action: string,
): TransitionRow | null {
  return transitions.find((t) => t.fromState === fromState && t.action === action) ?? null;
}

/**
 * §5.3 amend validation — content-only, document-owned keys (§3.7).
 * Returns the merged document `data` JSON + separate notes override, or a
 * blocking reason. PURE.
 */
export type AmendVerdict =
  | { ok: true; mergedData: Record<string, unknown>; notes?: string }
  | { ok: false; reason: string };

export function validateAmendData(
  current: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
): AmendVerdict {
  if (!data || Object.keys(data).length === 0) {
    return { ok: false, reason: 'amend requires a non-empty data payload' };
  }
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  let notes: string | undefined;
  for (const [key, value] of Object.entries(data)) {
    if (!(AMENDABLE_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        reason: `'${key}' is not amendable — document-owned content fields are: ${AMENDABLE_FIELDS.join(', ')}`,
      };
    }
    if (typeof value !== 'string') {
      return { ok: false, reason: `amend field '${key}' must be a string` };
    }
    if (key === 'notes') {
      notes = value;
    } else {
      merged[key] = value;
    }
  }
  return { ok: true, mergedData: merged, notes };
}

/**
 * §4.4 snapshot policy — should the engine capture a snapshot for this action?
 * captureOn phases: issue | post | amend. A `reverse` ALWAYS snapshots the
 * reversal (§3.6) regardless of policy. PURE.
 */
export function shouldCaptureSnapshot(
  captureOn: Array<'issue' | 'post' | 'amend'> | undefined,
  action: string,
  toStatus: string,
): boolean {
  if (action === 'reverse') return true;
  if (!captureOn || captureOn.length === 0) return false;
  if (action === 'issue' && captureOn.includes('issue')) return true;
  if (action === 'post' && captureOn.includes('post')) return true;
  if (action === 'amend' && captureOn.includes('amend')) return true;
  // Transition arrived at the target phase without the named action
  // (e.g. confirm→posted via a single action): capture on the resulting state.
  if (captureOn.includes('post') && toStatus === 'posted') return true;
  if (captureOn.includes('issue') && toStatus === 'issued') return true;
  return false;
}

/**
 * Evaluate a transition's guardJson against the runtime context.
 * Returns a list of human-readable blocking reasons (empty = pass).
 * Unknown vocabulary keys can never reach here — seed validation rejects them.
 */
export function evaluateGuards(
  guard: GuardJson | null | undefined,
  ctx: GuardEvalContext,
): string[] {
  const blocked: string[] = [];
  if (!guard) return blocked;

  if (guard.requiresReason && !ctx.reason?.trim()) {
    blocked.push('A reason is required for this action');
  }
  if (guard.requiresPaid && !ctx.isPaid) {
    blocked.push('The document must be fully paid before this action');
  }
  if (guard.requiresApproval && !ctx.hasApprovedRequest) {
    blocked.push('The document requires an approved approval request before this action');
  }
  if (guard.requiresSnapshot && !ctx.hasSnapshot) {
    blocked.push('The document requires a snapshot before this action');
  }
  // guard.permission is a (R)eference — the engine resolves it against the
  // actor's grants separately; nothing to evaluate here.
  // guard.allowsAnyState is documented as an audited admin override; the
  // engine treats a matching transition row as sufficient (state gating
  // already happened in findTransition).
  return blocked;
}

/** Is this transition a same-state reversal (posted → posted via `reverse`)? */
export function isReversal(transition: TransitionRow): boolean {
  return transition.action === 'reverse' && transition.fromState === transition.toState;
}

export interface EligibilityResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Cancel eligibility (§3.6): a document may be cancelled only while it has no
 * posted effects. The journal link is the DMS-visible effect marker; types
 * without accounting effects are cancellable from their pre-posted states.
 */
export function cancelEligibility(hasPostedEffects: boolean): EligibilityResult {
  if (hasPostedEffects) {
    return { allowed: false, reason: 'Document has posted effects — use reverse instead of cancel' };
  }
  return { allowed: true };
}

/**
 * Reversal eligibility (§3.6): reverse requires posted effects AND a registered
 * counterpart type. The engine creates the counterpart row; posting hooks
 * (domain-owned) push it through accounting.
 */
export function reversalEligibility(
  hasPostedEffects: boolean,
  counterpartCode: string | null,
): EligibilityResult {
  if (!hasPostedEffects) {
    return { allowed: false, reason: 'Document has no posted effects — use cancel instead of reverse' };
  }
  if (!counterpartCode) {
    return { allowed: false, reason: 'This document type is not reversable' };
  }
  return { allowed: true };
}

/** Compose the per-year sequence key: `invoice` → `invoice:2026` (legacy convention). */
export function composeSequenceKey(baseKey: string, year: number): string {
  return `${baseKey}:${year}`;
}

/** Compose the per-year prefix: `INV-` → `INV-2026-` (legacy convention). */
export function composeSequencePrefix(basePrefix: string | undefined, year: number): string {
  return `${basePrefix ?? ''}${year}-`;
}