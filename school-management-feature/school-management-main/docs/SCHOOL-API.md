# School API Reference (Uganda)

All endpoints live under `/school/*`. Every endpoint is gated by RBAC; the relevant `school:*` permission is checked by the `PermissionsGuard`.

The base URL assumes `http://localhost:3000` in dev. Replace with your deployment URL.

## Conventions

- All IDs are UUID v4 (`@default(uuid())`).
- All POST/PATCH bodies are JSON.
- Soft-deleted rows are filtered by the tenancy extension automatically; you don't need to pass `deletedAt`.
- Pagination: `?page=1&pageSize=20&search=...&sortBy=name&sortOrder=asc`.
- Decimal fields (amounts) are returned as strings to preserve precision.

## Permissions

| Permission | Used by |
|---|---|
| `school:read` | All GET endpoints |
| `school:foundation:write` | Campus / academic year / class / subject / timetable / lesson plan |
| `school:students:write` | Student / guardian / medical record / document |
| `school:staff:write` | Staff / position / staff attendance |
| `school:admissions:write` | Application / entrance exam / enrollment |
| `school:attendance:write` | Mark attendance / correction |
| `school:grades:write` | Exam / schedule / grade entry / approval |
| `school:fees:write` | Fee structure / schedule / billing / penalty run |
| `school:fees:collect` | Collect payment |
| `school:library:write` | Book / copy / borrow / return |
| `school:transport:write` | Vehicle / route / stop / assignment |
| `school:hostel:write` | Dormitory / room / bed / allocation |
| `school:cafeteria:write` | Meal plan / account / top-up / purchase |
| `school:communicate` | Notification template / message thread |
| `school:portal:parent` | Parent portal dashboard |
| `school:portal:student` | Student portal dashboard |
| `school:portal:teacher` | Teacher portal dashboard |

## Foundation (Sprint 1)

| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/campuses` | List campuses |
| `GET`   | `/school/campuses/:id` | Get one campus |
| `POST`  | `/school/campuses` | Create campus |
| `PATCH` | `/school/campuses/:id` | Update campus |
| `DELETE`| `/school/campuses/:id` | Soft delete campus |
| `GET`   | `/school/academic-years` | List academic years |
| `GET`   | `/school/academic-years/current` | Current year |
| `GET`   | `/school/academic-years/:id` | Get one academic year |
| `POST`  | `/school/academic-years` | Create academic year |
| `POST`  | `/school/academic-years/set-current` | Set the active year |
| `PATCH` | `/school/academic-years/:id` | Update |
| `DELETE`| `/school/academic-years/:id` | Soft delete |
| `GET`   | `/school/terms` | List terms |
| `GET`   | `/school/terms/current` | Current term |
| `GET`   | `/school/terms/by-year/:academicYearId` | Terms for a year |
| `GET`   | `/school/terms/:id` | Get one term |
| `POST`  | `/school/terms` | Create term |
| `POST`  | `/school/terms/set-current` | Set the active term |
| `PATCH` | `/school/terms/:id` | Update |
| `DELETE`| `/school/terms/:id` | Soft delete |
| `GET`   | `/school/departments` | List departments |
| `POST`  | `/school/departments` | Create |
| `PATCH` | `/school/departments/:id` | Update |
| `DELETE`| `/school/departments/:id` | Delete |
| `GET`   | `/school/grade-levels` | List grade levels (P.1 … S.6) |
| `GET`   | `/school/classes` | List classes |
| `POST`  | `/school/classes` | Create class |
| `GET`   | `/school/sections` | List sections |
| `POST`  | `/school/sections` | Create section |
| `GET`   | `/school/subjects` | List subjects |
| `POST`  | `/school/subjects` | Create |
| `GET`   | `/school/periods` | List periods (lesson slots) |
| `POST`  | `/school/periods` | Create period |
| `GET`   | `/school/calendar` | List calendar events |
| `GET`   | `/school/calendar/range?from=…&to=…` | Events between dates |
| `POST`  | `/school/calendar` | Create event |

## People (Sprint 2)

| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/students` | List students |
| `GET`   | `/school/students/by-class/:classId` | Roster for a class |
| `GET`   | `/school/students/:id/statement` | Full student profile (class, section, guardians, medical, history) |
| `POST`  | `/school/students` | Create student (Partner + StudentProfile) |
| `PATCH` | `/school/students/:id` | Update; pass `status` to transition (writes StudentStatusHistory + event) |
| `GET`   | `/school/guardians/by-student/:studentProfileId` | List guardians |
| `POST`  | `/school/guardians` | Add guardian (creates Contact + link) |
| `PATCH` | `/school/guardians/:id` | Update link |
| `GET`   | `/school/students/:id/medical-record` | Get medical record |
| `POST`  | `/school/students/:id/medical-record` | Upsert medical record |
| `GET`   | `/school/students/:id/documents` | List student documents |
| `POST`  | `/school/students/:id/documents` | Add document |
| `PATCH` | `/school/students/:id/documents/:docId/verify` | Verify document |
| `GET`   | `/school/staff` | List staff |
| `GET`   | `/school/staff/by-campus/:campusId` | Staff at a campus |
| `GET`   | `/school/staff/by-department/:departmentId` | Staff in a department |
| `POST`  | `/school/staff` | Create staff (Partner + StaffProfile) |
| `PATCH` | `/school/staff/:id` | Update; pass `status` to transition (writes StaffStatusHistory) |
| `GET`   | `/school/positions` | List positions |
| `POST`  | `/school/positions` | Create |
| `POST`  | `/school/staff-attendance/mark` | Bulk mark attendance (returns counts) |
| `GET`   | `/school/staff-attendance/by-date?date=…` | Day's attendance |
| `GET`   | `/school/staff-attendance/by-staff/:id?from=…&to=…` | Range |

## Admissions + Academics (Sprint 3)

### Admissions
| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/admissions` | List |
| `GET`   | `/school/admissions/by-status/:status` | Filter by status |
| `GET`   | `/school/admissions/:id` | Get one |
| `POST`  | `/school/admissions` | Create application (auto-generates `APP-…`) |
| `PATCH` | `/school/admissions/:id` | Update |
| `POST`  | `/school/admissions/:id/review` | Body `{action: 'review'\|'accept'\|'reject'\|'schedule_exam'\|'withdraw', notes?}` |
| `POST`  | `/school/admissions/:id/exam-score` | Upsert entrance exam score |
| `POST`  | `/school/admissions/:id/documents` | Add application document |
| `POST`  | `/school/admissions/documents/:documentId/verify` | Verify document |
| `POST`  | `/school/admissions/enroll` | **Keystone** — creates Partner + StudentProfile + Enrollment in one tx |

### Academics
| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/curricula` | List |
| `POST`  | `/school/curricula` | Create (with subjects array) |
| `GET`   | `/school/lesson-plans` | List |
| `GET`   | `/school/lesson-plans/by-teacher/:id` | By teacher |
| `POST`  | `/school/lesson-plans` | Create |
| `POST`  | `/school/lesson-plans/:id/publish` | Publish workflow transition |
| `GET`   | `/school/teacher-assignments/by-teacher/:id` | By teacher |
| `GET`   | `/school/teacher-assignments/by-class/:id` | By class |
| `POST`  | `/school/teacher-assignments` | Create |
| `GET`   | `/school/timetable/class/:classId` | Grid view |
| `POST`  | `/school/timetable/slots` | Create (validates teacher/room/class conflicts) |
| `POST`  | `/school/timetable/slots/bulk` | Bulk replace |
| `POST`  | `/school/timetable/slots/check-conflicts` | Pre-flight conflict check |

## Attendance + LMS (Sprint 4)

| Method | Path | Description |
|---|---|---|
| `POST`  | `/school/attendance/mark` | Bulk mark (returns counts + emits `school.attendance.marked`) |
| `GET`   | `/school/attendance/register?classId=…&date=…` | Daily register |
| `GET`   | `/school/attendance/weekly?classId=…&weekStart=…` | Weekly summary |
| `GET`   | `/school/attendance/by-student/:id?from=…&to=…` | Student summary |
| `POST`  | `/school/homework` | Create assignment |
| `POST`  | `/school/homework/submit` | Student submits |
| `POST`  | `/school/homework/grade` | Teacher grades |
| `GET`   | `/school/homework/by-class/:id` | Class assignments |
| `POST`  | `/school/learning-resources` | Create resource |
| `POST`  | `/school/announcements` | Create announcement |
| `POST`  | `/school/announcements/:id/publish` | Publish |
| `GET`   | `/school/announcements/feed?audience=students&classId=…` | Audience feed |

## Examinations & Grading (Sprint 5)

| Method | Path | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/school/exam-types` | CRUD |
| `GET/POST/PATCH/DELETE` | `/school/exams` | CRUD |
| `POST`  | `/school/exams/:id/publish` | Publish workflow |
| `POST`  | `/school/exams/:id/close` | Close workflow |
| `GET/POST/PATCH/DELETE` | `/school/exam-schedules` | CRUD |
| `POST`  | `/school/grades/bulk-upsert` | Bulk enter grades |
| `POST`  | `/school/grades/submit/:examScheduleId` | Submit for approval |
| `POST`  | `/school/grades/approve/:examScheduleId` | Approve (locks grades) |
| `GET`   | `/school/grades/by-class/:examScheduleId` | Class roster with grades |
| `GET/POST/PATCH/DELETE` | `/school/grading-scales` | CRUD |
| `GET`   | `/school/grading-scales/default` | Default scale |
| `POST`  | `/school/report-cards/generate` | Generate (computes GPA + rank) |
| `GET`   | `/school/report-cards/by-student/:id` | History |

## School Fees — Keystone (Sprint 6)

| Method | Path | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/school/fee-structures` | CRUD |
| `GET/POST/PATCH/DELETE` | `/school/fee-schedules` | CRUD |
| `GET`   | `/school/fee-schedules/for-term/:termId` | All schedules for a term |
| `GET/POST/PATCH/DELETE` | `/school/student-fee-assignments` | CRUD |
| `GET`   | `/school/student-fee-assignments/by-student/:id` | By student |
| `GET/POST/PATCH/DELETE` | `/school/discounts` | Catalog |
| `GET/POST/PATCH/DELETE` | `/school/scholarships` | Per-student |
| `GET`   | `/school/scholarships/active-for/:studentProfileId` | Active today |
| `GET/POST/PATCH/DELETE` | `/school/installment-plans` | Per-student |
| `GET/POST/PATCH/DELETE` | `/school/penalty-rules` | Rules |
| `GET`   | `/school/penalty-runs` | History |
| `GET`   | `/school/penalty-runs/by-schedule/:id` | By schedule |
| `POST`  | `/school/billing/generate` | **Generate term invoices** for a class or all |
| `POST`  | `/school/billing/penalty-run/:scheduleId` | Run penalty assessment |
| `POST`  | `/school/payments/collect` | **Collect payment** — allocates oldest-first across student's open invoices |

### Generate billing example

```http
POST /school/billing/generate
{
  "termId": "term_…",
  "classId": "class_…"  // optional; omit to bill all classes
}
```

Returns `{count, documents: [...]}` — each document is a `sales_invoice` ready to be posted via the Invoicing workflow.

### Collect payment example

```http
POST /school/payments/collect
{
  "studentProfileId": "stu_…",
  "amount": 500000,
  "paymentMethod": "mobile_money",
  "reference": "MTN-12345",
  "notes": "Term 1 partial"
}
```

Returns `{payment, allocations: [{documentId, amount}], unallocated}`. The `Payment` row is in `posted` status; allocations are in `PaymentAllocation`; each invoice's `amountPaid` / `amountResidual` / `paymentStatus` are updated atomically.

## Portals (Sprint 7)

| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/portals/parent/:studentProfileIds` | Comma-separated student IDs |
| `GET`   | `/school/portals/student/:id` | Today's timetable + attendance + grades + assignments + announcements |
| `GET`   | `/school/portals/teacher/:id` | Classes + today's schedule + pending grades |

## Communication (Sprint 8)

| Method | Path | Description |
|---|---|---|
| `GET/POST/PATCH/DELETE` | `/school/notification-templates` | CRUD |
| `POST`  | `/school/notifications/enqueue` | Queue notification |
| `GET`   | `/school/notifications/inbox?recipientType=…&recipientId=…` | Inbox |
| `POST`  | `/school/notifications/mark-sent` | Provider callback |
| `POST`  | `/school/notifications/mark-failed` | Provider callback |
| `POST`  | `/school/messages` | Create thread |
| `POST`  | `/school/messages/post` | Post message |
| `GET`   | `/school/messages/mine?participantId=…` | My threads |

## Library + Transport + Hostel + Cafeteria (Sprints 9 + 10)

Standard CRUD per resource under `/school/library/{books,copies,borrowings}`, `/school/transport/{vehicles,routes,stops,route-assignments,assignments}`, `/school/hostel/{dormitories,rooms,beds,allocations}`, `/school/cafeteria/{plans,accounts}`.

Notable special endpoints:
- `POST /school/library/borrowings/borrow` — borrow a copy
- `POST /school/library/borrowings/:id/return` — return a copy (auto-creates fine invoice if overdue)
- `POST /school/transport/assignments/assign` — assign student to a route
- `POST /school/hostel/allocations/allocate` — allocate bed
- `POST /school/hostel/allocations/:id/checkout` — checkout student
- `POST /school/cafeteria/accounts/top-up` — top up meal balance
- `POST /school/cafeteria/accounts/purchase` — debit a purchase

## Reports (Sprint 11)

| Method | Path | Description |
|---|---|---|
| `GET`   | `/school/reports/admin` | Students, staff, campuses, classes, outstanding fees |
| `GET`   | `/school/reports/academic` | Pass rate, total grades, approved grades |
| `GET`   | `/school/reports/finance` | Collections this month, outstanding total |
| `GET`   | `/school/reports/operational` | Staff count, teacher assignments, avg periods/week |
| `GET`   | `/school/reports/outstanding-by-class` | Outstanding fees grouped by class |
| `GET`   | `/school/reports/attendance-today` | Today's attendance counts |
| `GET`   | `/school/reports/top-performers?limit=10` | Top GPAs in current term |
| `GET`   | `/school/reports/daily-collections?days=30` | Daily collections for last N days |