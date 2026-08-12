/**
 * An `Order.transactionKind` a module owns (Phase D). Contributing kinds through
 * the manifest is what lets `transactionKind` be free text validated against the
 * registry instead of a shared `SaleKind` enum — a new vertical adds its kind
 * here rather than editing a central enum.
 */
export interface OrderKindContribution {
  /** Stored in `Order.transactionKind`, e.g. `sale`, `rental`, `repair`. */
  code: string;
  /** Human label for reporting/UI. */
  label: string;
}

/**
 * Manifest every pluggable ERP module exports (ADR-005). The registry validates
 * the dependency graph at boot and fails loudly on cycles / missing deps.
 */
export interface ERPModule {
  /** Unique module name, e.g. "core", "accounting", "inventory". */
  name: string;
  version: string;
  /** Names of modules this one requires (must be registered). */
  dependencies: string[];
  /** `resource:action` permissions this module owns (optional, for docs/seed). */
  permissions?: string[];
  /** Domain events this module publishes (optional, for docs). */
  events?: string[];
  /**
   * `Order.transactionKind` codes this module owns (Phase D). Aggregated by the
   * registry so order writers can validate the kind without a shared enum.
   *
   * The same manifest-contribution pattern extends to workflows, milestones and
   * fulfillment strategies; those are registered today via dedicated module
   * initializers (`Pos*Initializer`) and can fold into the manifest later.
   */
  orderKinds?: OrderKindContribution[];
}
