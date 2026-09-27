# Architecture Decision Records (ADR)

These records capture the **why** behind the platform's foundational decisions so
future contributors don't re-litigate settled trade-offs. Each ADR is immutable
once Accepted; to change a decision, add a new ADR that supersedes it.

| ADR | Title | Status |
|-----|-------|--------|
| [001](./ADR-001-modular-monolith.md) | Modular Monolith vs Microservices | Accepted |
| [002](./ADR-002-prisma-vs-typeorm.md) | Prisma vs TypeORM | Accepted |
| [003](./ADR-003-event-bus.md) | Event Bus Design | Accepted |
| [004](./ADR-004-multi-tenant-strategy.md) | Multi-Tenant Strategy | Accepted |
| [005](./ADR-005-module-registration.md) | Module Registration Strategy | Accepted |
| [006](./ADR-006-audit-logging.md) | Audit Logging Design | Accepted |
| [007](./ADR-007-workflow-engine.md) | Workflow Engine Design | Accepted |
| [008](./ADR-008-master-data-partner.md) | Master-Data & Partner Modeling | Accepted |
| [009](./ADR-009-general-ledger-engine.md) | General Ledger Engine & Posting Service | Accepted |
| [010](./ADR-010-document-ar-model.md) | Document Framework & Accounts Receivable | Accepted |
| [011](./ADR-011-vertical-extension-contract.md) | Vertical Extension Contract | Accepted |
| [012](./ADR-012-table-management.md) | Table Management | Accepted |
| [013](./ADR-013-school-fee-economic-events.md) | School Fee Economic Events | Accepted |
| [014](./ADR-014-lms-moodle-architecture.md) | LMS (Moodle-Shaped) Architecture | Accepted |
| [015](./ADR-015-configurable-admission-workflow.md) | Configurable Admission Workflow | Accepted |
| [016](./ADR-016-messaging-broadcasts-and-transports.md) | Messaging: Multi-Transport Delivery, Consent and Broadcasts | Accepted |
| 017 | Registry-Driven Reporting (implementation exists; ADR record pending) | Proposed |
| [018](./ADR-018-enrollment-placement-history.md) | Enrollment and Placement History | Proposed |
| [019](./ADR-019-section-stream-grouping.md) | Section and Stream Grouping Modes | Proposed |
| [020](./ADR-020-learning-offering-types.md) | CourseOffering as the Learning Offering | Proposed |
| [021](./ADR-021-course-vs-assessment-rosters.md) | Course Membership and Frozen Assessment Rosters | Proposed |
| [022](./ADR-022-assignment-consolidation.md) | Assignment Consolidation | Proposed |
| [023](./ADR-023-assessment-lifecycle.md) | Assessment Lifecycle and Learner Evidence | Proposed |
| [024](./ADR-024-result-immutability.md) | Immutable ResultSet Revisions | Proposed |
| [025](./ADR-025-report-document-provenance.md) | Report-Document Provenance | Proposed |
| [026](./ADR-026-lms-academic-core-boundary.md) | LMS as a Consumer of the Academic Core | Proposed |
| [027](./ADR-027-legacy-academic-retirement.md) | Legacy Academic Retirement Strategy | Proposed |
| [028](./ADR-028-examination-operations-integrity.md) | Examination Operations and Result Integrity | Proposed |
| [032](./ADR-032-launch-safety-policies.md) | Launch Safety Policies | Accepted |

Template: **Context → Decision → Consequences → Alternatives considered.**
