# ADR-005: Module Registration Strategy

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
Modules must be pluggable and obey strict downward-only dependencies. We need to
catch a broken dependency graph at boot, not in production.

## Decision
**Manifest-based, compile-time registration with boot-time validation.**
Each module exports an `ERPModule` manifest:

```ts
export interface ERPModule {
  name: string;
  version: string;
  dependencies: string[];   // names of modules this one requires
  permissions?: string[];   // resource:action strings it owns
  events?: string[];        // domain events it publishes
}
```

A `ModuleRegistry` collects all manifests, builds the dependency graph,
**topologically sorts it, and fails loudly on cycles or missing dependencies**.
Modules are still wired as NestJS modules; the registry adds validation and a
queryable list of enabled modules. Per-organization enable/disable is a
`Setting` flag checked by guards/routes (not dynamic code loading).

## Consequences
**Positive**
- Deterministic, validated boot; the dependency rule is provable.
- Plays directly to NestJS DI; no bespoke loader runtime.

**Negative / Trade-offs**
- Not runtime-installable in the browser (Odoo-style). Acceptable: modules are
  first-party and shipped by us, toggled per tenant via settings.

## Alternatives considered
- **Dynamic runtime install (metadata-driven):** rejected — multi-year framework
  cost; see `TRANSFER.md`.
- **Plain manual `imports: []`:** loses dependency validation and the enabled-
  module registry.
