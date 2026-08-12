# ADR-007: Workflow Engine Design

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
Many future documents (invoices, POs, payments, journal entries) share the same
lifecycle and approval needs. We must not hardcode status logic per entity.

## Decision
A **generic, declarative state machine** reused by every document type. Canonical
states: `Draft → Submitted → Approved / Rejected → Posted → Cancelled → Closed`.

A `WorkflowDefinition` declares states and transitions:

```ts
interface WorkflowTransition {
  from: string; to: string; action: string;
  permission?: string;            // resource:action required to perform it
  guard?: (ctx) => boolean | Promise<boolean>;
}
```

A `WorkflowService.transition(entity, action, ctx)` validates the transition,
checks permission + guard, updates `currentState`, writes an `AuditLog`, and
emits a domain event (e.g. `invoice.posted`). Documents store only their
`currentState`; the rules live in the definition.

## Consequences
**Positive**
- One approval/lifecycle engine across all modules; consistent UX and audit.
- New document types declare transitions instead of writing status code.

**Negative / Trade-offs**
- Initial abstraction cost; complex parallel/multi-approver flows are deferred to
  a later iteration of the engine.

## Alternatives considered
- **Per-entity status fields + ad-hoc checks:** duplication and drift across
  modules.
- **External BPMN engine (e.g. Camunda):** heavyweight; revisit only if true
  business-process orchestration is required.
