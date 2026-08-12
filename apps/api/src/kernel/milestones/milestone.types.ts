import type { DomainEventName } from '@erp/shared';

/**
 * A milestone is a business-friendly PROJECTION over the event ledger
 * (`DomainEventLog`) — not a stored column. It answers "did X happen, and when?"
 * for a given entity by scanning that entity's recorded facts.
 *
 * Keeping milestones derived (rather than denormalized timestamp columns) means:
 *   - a milestone can be added, renamed or recomputed without a migration;
 *   - history is never destroyed. The denormalized columns are lossy — e.g.
 *     `KitchenTicket.readyAt` is NULLED on recall, so the column can only report
 *     the LAST ready time; the ledger keeps every one, so first-pass prep time
 *     stays recoverable (this is the live KDS reporting bug Phase B fixes).
 */
export interface MilestoneDefinition {
  /** Stable key, e.g. `kitchen_ready`. */
  key: string;
  /** Human label for dashboards, e.g. "Kitchen Ready". */
  label: string;
  /** The entity type these milestones describe, e.g. `order`. */
  entityType: string;
  /** The business event that satisfies this milestone. */
  fromEvent: DomainEventName;
  /**
   * Optional payload predicate, so several milestones can share one event name
   * discriminated by payload — e.g. kitchen vs delivery both use
   * `fulfillment.completed`, told apart by `payload.strategy`.
   */
  match?: (payload: Record<string, unknown>) => boolean;
  /**
   * `first` (default) records the earliest matching fact — the natural choice
   * for a "when did this first happen" milestone, and what makes recall-proof
   * prep timing work. `last` records the most recent.
   */
  occurrence?: 'first' | 'last';
  /** Presentation order in the projected list. */
  sequence: number;
}

/** One projected milestone for a specific entity. */
export interface ProjectedMilestone {
  key: string;
  label: string;
  sequence: number;
  /** True when a matching fact exists. */
  reached: boolean;
  occurredAt: Date | null;
  actorId: string | null;
  /** How many matching facts were seen (recalls make this > 1). */
  count: number;
}
