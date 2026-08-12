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
}
