# School vertical — architecture

The school vertical lives at `apps/api/src/modules/school/`. It is one of the **verticals** allowed by ADR-011 — it imports downward into `core`, `accounting`, `invoicing`, `inventory`, and `kernel`, but never into another vertical. The dependency-cruiser config in `.dependency-cruiser.cjs` enforces this at lint time.

## Layering

```
                 ┌────────────────────────────────────────┐
                 │              SchoolModule               │  vertical (manifest)
                 │      registers workflows + modules       │
                 └──────────────┬─────────────────────────┘
                                │
        ┌───────────────────────┼──────────────────────┐
        │                       │                      │
   FoundationModule      PeopleModule         AdmissionsModule …
        │                       │                      │
        └─────────────┬─────────┴──────────────────────┘
                      │
        ┌─────────────┴──────────────────────────────────┐
        │       CoreModule (Partner, Product, …)         │
        │       InvoicingModule (Document, Payment)      │
        │       AccountingModule (Posting, Accounts)     │
        │       InventoryModule (Stock)                  │
        └──────────────────────────────────────────────┘
                      │
              ┌───────┴───────┐
              │  KernelModule │
              │  (workflow,    │
              │  tenancy,      │
              │  events, audit)│
              └───────────────┘
```

## Money flow (Sprint 6 — keystone)

A school fee bill flows exactly the same way a POS sale does:

1. `BillingService.generateForTerm(termId, classId?)` creates a `Document(type='sales_invoice')` per student. The document has one line per fee component (Tuition, Transport, …), each linked to a `Product(type='service')`.
2. The document starts in `draft` status. When the bursar posts it, `PostingService` writes a journal entry that credits the income account (resolved via AccountMapping) and debits the AR control account.
3. `SchoolPaymentService.collect({…})` wraps the existing `PaymentService.record` flow. The Payment row is in `posted` status; allocations go into `PaymentAllocation`. The Document's `amountPaid`, `amountResidual`, and `paymentStatus` are updated atomically.
4. AR aging, customer statements, daily collections report — all reuse the **existing** reporting module.
5. Library fines are `Document(type='sales_invoice')` with `sourceType='library_fine'`.

**Zero new accounting code** — that is the proof of reuse.

## State machines

| Entity | Workflow name | States |
|---|---|---|
| `AdmissionApplication` | `admission_application` | submitted → under_review → (exam_scheduled \| accepted) → enrolled \| withdrawn |
| `LessonPlan` | `lesson_plan` | draft → published |
| `Exam` | `exam` | draft → scheduled → published → closed |
| `GradeEntry` | `grade_entry` | draft → submitted → approved (rejected → resubmit) |
| `AttendanceCorrection` | `attendance_correction` | draft → approved \| rejected |

All definitions are registered in `SchoolModule.onModuleInit` against the `WorkflowRegistry` singleton. Transitions can use `WorkflowService.transition({entityType, entityId, action, payload, entity})` — it loads the entity, checks the permission, runs guards, runs side effects, updates status, audits, and emits the event in one transaction.

## Tenancy

Every school table has `organizationId NOT NULL` and is registered in `ORG_SCOPED` in `kernel/prisma/tenancy.extension.ts`. The `tenancyExtension` Prisma Client Extension injects `organizationId` on `create`/`createMany` and filters `where.organizationId` on every read/update/delete (using the `TenantContextService` AsyncLocalStorage context).

RLS still applies (per ADR-004): even if a vertical forgot to scope a query, the row-level security policy on every school table rejects rows from other orgs.

## Events

The vertical publishes domain events for every meaningful state change:

- `school.student.created` — emitted when an application is enrolled
- `school.student.status.changed` — status transition
- `school.admission.{submitted,under_review,exam_scheduled,accepted,rejected,enrolled,withdrawn}`
- `school.lesson_plan.published`
- `school.attendance.marked` (with summary counts)
- `school.exam.{scheduled,published,closed}`
- `school.grade.{posted,approved}`
- `school.reportcard.generated`
- `school.fee.invoice.{drafted,posted,overdue}`
- `school.fee.payment.recorded`
- `school.fee.penalty.run`
- `school.notification.sent`
- `school.message.sent`
- `school.library.{borrowed,returned,overdue}`
- `school.transport.assigned`
- `school.hostel.allocated`
- `school.meal.topup`

Subscribers (notification triggers, accounting observers) live in `communication/communication.service.ts`. The Communication sprint's `NotificationService` consumes events and resolves the matching template to enqueue a `Notification` row. The actual SMS/email send is delegated to a pluggable provider (console in dev, Twilio / SendGrid / FCM in prod — not implemented in v1).

## Adding a new entity

1. Add it to `apps/api/prisma/schema.prisma` (org-scoped).
2. `pnpm db:migrate` to generate the migration.
3. Add the model name to `ORG_SCOPED` in `kernel/prisma/tenancy.extension.ts`.
4. Create `apps/api/src/modules/school/<topic>/<topic>.service.ts` extending `BaseCrudService`.
5. Create the controller in `apps/api/src/modules/school/<topic>/<topic>.controller.ts`.
6. Register in `<topic>.module.ts`.
7. Import the module in `school.module.ts`.
8. If the entity has a lifecycle, register a `WorkflowDefinition` in `school.module.ts`.

That's it. Every new table inherits RLS, audit, events, search, pagination, soft delete (where applicable), and is available to the portals + reporting immediately.

## Files of interest

- `school.module.ts` — manifest + workflow registry
- `fees/billing.service.ts` — the keystone
- `people/student.service.ts` — Partner + StudentProfile atomic creation
- `admissions/admissions.service.ts` — application → enrollment with side effects
- `attendance/student-attendance.service.ts` — bulk-mark with event summary
- `reporting/reporting.service.ts` — four dashboard endpoints
- `library/library-transport-hostel-cafeteria.service.ts` — combined CRUD for Sprints 9 + 10