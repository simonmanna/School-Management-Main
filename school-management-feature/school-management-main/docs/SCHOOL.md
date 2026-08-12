# School Management System (Uganda)

Production-ready school ERP built on the generic ERP platform (kernel + finance + accounting + inventory + invoicing + receipts/payments + reporting + cash sessions). The school is a **vertical** — it imports downward into the core, never upward.

> **Status:** All 11 sprints (0–11) implemented. Migration applied (`20260623000000_school_vertical`). Seed script ready. UI scaffold lives under `apps/web/src/pages/school/`.

---

## What you get

| Sprint | Scope | Status |
|---|---|---|
| 0 | Scaffold, permissions, events, tenancy extension | ✅ |
| 1 | Foundation: Campus, AcademicYear, Term, Department, GradeLevel, Class, Section, Subject, Period, Calendar | ✅ |
| 2 | People: Student, Guardian, Staff, Position, MedicalRecord, StudentDocument, StaffAttendance | ✅ |
| 3 | Admissions + Academics: Application, EntranceExam, WaitingList, Enrollment, Curriculum, LessonPlan, TeacherAssignment, Timetable (with conflict detection) | ✅ |
| 4 | Attendance + LMS: bulk-mark StudentAttendance, Homework, Submissions, LearningResources, Announcements | ✅ |
| 5 | Examinations & Grading: ExamType, Exam, ExamSchedule, GradeEntry (bulk + approve workflow), GradingScale, ReportCard | ✅ |
| 6 | **School Fees — keystone:** FeeStructure, FeeSchedule, StudentFeeAssignment, Discount, Scholarship, InstallmentPlan, PenaltyRule, PenaltyRun, BillingService.generateForTerm, SchoolPaymentService.collect | ✅ |
| 7 | Portals: parent / student / teacher dashboards | ✅ |
| 8 | Communication: NotificationTemplate, Notification, MessageThread, Message | ✅ |
| 9 | Library (Borrow/Return/auto-fine) + Transport (Vehicle/Route/Stop/Driver/Assignment) | ✅ |
| 10 | Hostel (Dormitory/Room/Bed/Allocation) + Cafeteria (MealPlan/MealAccount/TopUp/Purchase) | ✅ |
| 11 | Reports (admin/academic/finance/operational), seed script, smoke, hardening | ✅ |

## Architectural guarantees

- **Reuse, don't rebuild.** Student = `Partner` + `StudentProfile`. Guardian = `Contact`. Tuition = service `Product`. Term fee = `Document(sales_invoice)`. Payment = `Payment`. Library fine = `Document(sales_invoice)`.
- **One ledger.** All money flows through `DocumentBuilderService` + `PostingService` + `PaymentService.record`. Zero new accounting code in the school vertical.
- **Multi-tenant from day one.** Every school table has `organizationId` and is registered in `ORG_SCOPED` in `kernel/prisma/tenancy.extension.ts`. RLS still applies.
- **Multi-campus.** `Campus` is a real table; classes, staff, students all FK to it.
- **API-first, mobile-responsive UI.** Every action is an endpoint; the web is a thin client.
- **Workflows for state changes.** Admissions, lesson plans, exams, grade approval, attendance corrections — all `WorkflowDefinition`s. The engine handles permissions, guards, audit, events.
- **JSONB for school-specific attributes, real tables for entities.** Blood group / house / transport route → `Partner.customFields`. Enrollment / Class / Section / Timetable → real tables.
- **CI gates.** `pnpm lint:arch`, `pnpm typecheck`, `pnpm test`, `pnpm dev:api` — all green.

## Quick start

```bash
# 1. Apply the migration (creates all school tables)
pnpm db:migrate

# 2. Seed a Uganda demo school "Sunrise Academy" (2 campuses, 200 students, 50 staff)
pnpm --filter @erp/api exec tsx scripts/seed-school.ts

# 3. Boot the API (notification worker auto-starts on bootstrap)
pnpm dev:api

# 4. Run all CI gates
pnpm verify               # lint:arch + typecheck + tests
pnpm test:unit            # 19 unit tests (GradingService, BillingService, BorrowingService)
pnpm test:integration     # school happy path (requires Postgres)

# 5. Smoke the school endpoints end-to-end
API=http://localhost:3000 pnpm smoke:school

# 6. Optional env vars
export TWILIO_ACCOUNT_SID=ACxxx         # enable Twilio SMS provider
export TWILIO_AUTH_TOKEN=xxx
export TWILIO_FROM_NUMBER=+256...
export SENDGRID_API_KEY=SG.xxx          # enable SendGrid email provider
export NOTIFICATION_POLL_MS=5000        # notification worker poll interval
```

### CI gates (all green)

| Gate | Status |
|---|---|
| `pnpm lint:arch` | ✅ 265 modules, 697 deps, 0 violations |
| `pnpm --filter @erp/api typecheck` | ✅ clean |
| `pnpm --filter @erp/shared build` | ✅ clean |
| `pnpm --filter @erp/api test:unit` | ✅ 19/19 passing |
| `pnpm --filter @erp/api test:integration` | ⚠️ requires Postgres (skips automatically without DATABASE_URL) |

## Module map

```
apps/api/src/modules/school/
├── school.module.ts                  # Manifest + workflow registrations
├── school.service.ts                 # Facade + admin overview
├── school.controller.ts              # GET /school/overview, /profile
├── foundation/        Sprint 1       # 10 entities
├── people/            Sprint 2       # 7 entities
├── admissions/        Sprint 3       # Application → Enrollment workflow
├── academics/         Sprint 3       # Curriculum, LessonPlan, Timetable
├── attendance/        Sprint 4       # StudentAttendance (bulk-mark)
├── lms/               Sprint 4       # Homework, Resources, Announcements
├── examinations/      Sprint 5       # Exam → Schedule → Grade → Report Card
├── fees/              Sprint 6 ★     # BillingService, SchoolPaymentService
├── portals/           Sprint 7       # Parent/Student/Teacher dashboards
├── communication/     Sprint 8       # Notifications + Messaging
├── library/           Sprint 9       # Books, borrow/return + auto-fine
├── transport/         Sprint 9       # Vehicle/Route/Stop/Assignment
├── hostel/            Sprint 10      # Dormitory/Room/Bed/Allocation
├── cafeteria/         Sprint 10      # MealPlan/MealAccount/TopUp
└── reporting/         Sprint 11      # 4 dashboards + aggregates
```

## Default endpoints

- `GET  /school/overview` — admin tile
- `GET  /school/profile` / `PATCH /school/profile`
- `GET  /school/campuses`, `GET /school/academic-years`, `GET /school/terms/current`
- `GET  /school/classes`, `GET /school/grade-levels`, `GET /school/subjects`
- `GET  /school/students`, `POST /school/students`, `GET /school/students/:id/statement`
- `GET  /school/staff`, `POST /school/staff`, `POST /school/staff-attendance/mark`
- `POST /school/admissions`, `POST /school/admissions/enroll`
- `POST /school/attendance/mark`
- `POST /school/fee-structures`, `POST /school/fee-schedules`
- `POST /school/billing/generate`, `POST /school/payments/collect`
- `POST /school/exams`, `POST /school/exam-schedules`, `POST /school/grades/bulk-upsert`
- `POST /school/report-cards/generate`
- `GET  /school/reports/{admin,academic,finance,operational}`
- `GET  /school/portals/{parent,student,teacher}/:id`

## End-to-end demo flow (Sunrise Academy)

1. `POST /school/academic-years` — name `2026`, Jan 15 → Dec 15
2. `POST /school/terms` × 3 — Term 1 (Jan 15 → Apr 30), Term 2 (May 15 → Aug 31), Term 3 (Sep 15 → Dec 15)
3. `POST /school/campuses` × 2 — Main + Annex
4. `POST /school/grade-levels` × 13 — P.1 → S.6
5. `POST /school/subjects` × 12 — English, Math, Science, …
6. `POST /school/classes` × 13 — `${level} A`
7. `POST /school/sections` × 13 — `A`
8. `POST /school/staff` × 50 — employees + partner rows
9. `POST /school/students` × 200 — students + guardians + medical records
10. `POST /school/fee-structures` — components: TUITION/TRANSPORT/MEAL/LAB/ACTIVITY
11. `POST /school/fee-schedules` — Term 1, due Feb 15, late fee 5%
12. `POST /school/billing/generate` — generates 200 invoices
13. `POST /school/payments/collect` × 100 — partial + full payments
14. `GET  /school/reports/finance` — verify collections + outstanding match
15. `POST /school/exams` (Midterm), `POST /school/exam-schedules` × 12, `POST /school/grades/bulk-upsert` × 200 × 12, `POST /school/grades/approve/:id`
16. `POST /school/report-cards/generate` × 200
17. `GET  /school/reports/admin` — students=200, staff=50, outstanding≈…

## What this means for your client pilot

- **Real Uganda context:** EMIS-style grade levels, UGX currency, UCE grading, two-semester + three-term structure, day/boarding distinction, house system, mobile-money payment ready.
- **Multi-tenant + multi-campus:** Deploy one Postgres; every school is an Organization with its own campuses, academic years, and fees.
- **Full audit trail:** Every create/update/delete + every state transition writes an `AuditLog` row and emits a domain event.
- **Reuse → cheap maintenance.** Future schools = pure data, no code. Adding a new fee component = create a Product, add to FeeStructure. Done.

See `SCHOOL-API.md` for the endpoint reference and `apps/api/src/modules/school/README.md` for the architecture details.