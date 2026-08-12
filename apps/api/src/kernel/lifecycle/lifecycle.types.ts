/**
 * Custody lifecycle kernel — a small state machine for entities that move
 * through a checked-out → returned → inspected → disposed sequence.
 *
 * Rental is consumer #1 (`custody.rental_unit`). Repairs / equipment loans /
 * library-style lending register their own definition later and reuse the
 * return, inspection and disposition logic untouched. Deliberately NOT a
 * speculative full fulfillment API — only the part that is real code either way.
 */

/** One state in a lifecycle definition. */
export interface LifecycleState {
  key: string;
  label: string;
}

/** One guarded transition: from → to, triggered by an action. */
export interface LifecycleTransition {
  from: string | null; // null = any state except the `to`
  to: string;
  action: string;
}

/** The full definition a module registers. */
export interface LifecycleDefinition {
  /** e.g. `custody.rental_unit`. */
  key: string;
  entityType: string; // e.g. `rental_unit`
  states: readonly string[];
  transitions: readonly LifecycleTransition[];
  /** States from which no further transition is allowed. */
  terminalStates: readonly string[];
}

/**
 * Declarative disposition policy: maps an inspection outcome → the next unit
 * state. Defaults live in code; overridable per org via the
 * `rental.dispositionPolicy` setting (a JSON blob of these rules).
 */
export interface DispositionRule {
  /** Matches when the return line's conditionGrade equals this. */
  conditionGrade?: string;
  /** Matches when the return line has damages (RentalDamage rows). */
  hasDamages?: boolean;
  /** Matches when the return line is missing (not returned). */
  isMissing?: boolean;
  /** Matches when the unit is beyond economic repair. */
  beyondRepair?: boolean;
  nextState: string;
}

export const DEFAULT_DISPOSITION_POLICY: readonly DispositionRule[] = [
  // Returned in good shape, no damages → cleaning (or available if the product
  // does not require cleaning — the caller decides between the two).
  { conditionGrade: 'excellent', hasDamages: false, nextState: 'cleaning' },
  { conditionGrade: 'good', hasDamages: false, nextState: 'cleaning' },
  // Fair/poor condition or any damage → repair.
  { conditionGrade: 'fair', nextState: 'repair' },
  { conditionGrade: 'poor', nextState: 'repair' },
  { hasDamages: true, nextState: 'repair' },
  // Damaged beyond repair → damaged (awaiting retire decision).
  { conditionGrade: 'damaged', beyondRepair: true, nextState: 'damaged' },
  // Never came back → lost.
  { isMissing: true, nextState: 'lost' },
];
