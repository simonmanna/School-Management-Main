import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Models that carry a (non-null) organizationId and must be auto-scoped.
 * NOTE: Setting has a nullable organizationId and is handled manually in
 * SettingsService, so it is intentionally excluded here.
 *
 * Exported so `tenancy-registration.spec.ts` can prove this set stays in sync
 * with schema.prisma. A model missing from here is a silent cross-tenant leak,
 * not an error — the spec is what turns that into a red build.
 */
export const ORG_SCOPED = new Set<string>([
  'User',
  'Role',
  'RefreshToken',
  'AuditLog',
  'Partner',
  'PartnerCategory',
  'MembershipTier',
  'Contact',
  'Address',
  'Product',
  'ProductCategory',
  'UnitOfMeasure',
  'UomCategory',
  'ProductPackaging',
  'ProductUomConversion',
  'Tax',
  'FiscalPeriod',
  'Branch',
  // Phase 2 — accounting
  'Account',
  'Journal',
  'JournalEntry',
  'JournalLine',
  'AccountMapping',
  'BankAccount',
  // Phase 3 — documents / AR
  'Document',
  'DocumentLine',
  'Payment',
  'PaymentAllocation',
  'PaymentAllocationReversal',
  // Phase 4 — inventory
  'InventoryLocation',
  'StockItem',
  'InventoryBatch',
  'InventoryLedger',
  'InventorySerial',
  // Deferred stock-posting queue + its exception work-list. These carry an
  // organizationId but were never scoped, so the Posting Monitor read them with
  // no org predicate (cross-tenant leak / IDOR by id). The drain worker reaches
  // across orgs deliberately and does so via prisma.raw, which bypasses this
  // extension, so scoping the typed client here does not affect it.
  'StockPostingJob',
  'InventoryException',
  // F.8 — inventory masters + stock document wrappers
  'Brand',
  'ProductVariant',
  'StockOut',
  'StockOutItem',
  'WasteRecord',
  'WasteItem',
  'StockAdjustment',
  'StockAdjustmentItem',
  'StockTransfer',
  'StockTransferItem',
  // Phase 3 — soft stock reservations (available-to-promise)
  'StockReservation',
  // Inventory count sessions (opening/closing physical counts)
  'InventoryCountSession',
  'InventoryCountLine',
  // Beverage Control — digital-weight alcohol measurement (bar)
  'BottleCountSession',
  'BottleCountLine',
  'BottleCountReading',
  'BottleMeasurement',
  // M5 — cash sessions (CashRegister is config, sessions/movements are transactional)
  'CashRegister',
  'CashSession',
  'CashMovement',
  // D1-2 — idempotency cache (org-scoped transactional; no soft delete)
  'IdempotencyRecord',
  // D3 — reporting snapshots (no soft delete; rebuilt periodically)
  'ReportTrialBalanceSnapshot',
  'ReportPnLSnapshot',
  'ReportBalanceSheetSnapshot',
  'ReportApAgingSnapshot',
  'ReportTieoutSnapshot',
  // D4-3 — transactional outbox (no soft delete; rows are shipped and kept)
  'EventOutbox',
  // P1 — offline sync (device registry + dead-lettered ops)
  'PosDevice',
  'SyncOpDeadLetter',
  // F.5 — Notifications, files, approvals, recurring, webhooks, feature flags
  'Notification',
  'NotificationPreference',
  'File',
  'OneTimeToken',
  'ApprovalRequest',
  'ApprovalDecision',
  'ApprovalPolicy',
  // F.5b — multi-step approval workflows
  'ApprovalWorkflow',
  'ApprovalStep',
  'RecurringDocument',
  'RecurringDocumentRun',
  'WebhookEndpoint',
  'WebhookDelivery',
  'FeatureFlag',
  'SavedReport',
  'SavedReportRun',
  'OrganizationModule',
  // F.6 — Procurement chain (transactional lines use status, not soft delete)
  'PurchaseRequest',
  'PurchaseRequestLine',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceiptNote',
  'GoodsReceiptLine',
  'VendorBillLink',
  'ThreeWayMatch',
  // F.6 — Debit notes
  'DebitNote',
  'DebitNoteLine',
  // F.6 — Push notification subscriptions
  'PushSubscription',
  // F.6 — Append-only audit trail (no soft delete, no UPDATE/DELETE)
  'DomainEventLog',
  // F.7 — CRM pipeline
  'Deal',
  'Activity',
  // DMS — generic document management (registry; per-org activation rows)
  'OrganizationDocumentType',
  'DocumentAction',
  // Phase 4/5 — snapshot/relation/attachment/source/version tables
  'DocumentSnapshot',
  'DocumentRelation',
  'DocumentAttachment',
  'DocumentSource',
  'DocumentVersion',
  // Phase 8 — workflow hook ledger
  'DMSWorkflowLedger',
  // POS Phase A — held orders
  'PosHold',
  'PosHoldLine',
  // POS Phase D — Modifiers + Combos (P4)
  'ModifierGroup',
  'Modifier',
  'ProductModifierGroup',
  'MenuItemModifierGroup',
  'Combo',
  'ComboItem',
  // POS Phase D — Variants + Accompaniments
  'MenuItemVariant',
  'AccompanimentGroup',
  'AccompanimentOption',
  'MenuItemAccompanimentGroup',
  // POS Phase D — KDS (P5)
  'KitchenTicket',
  'KitchenStation',
  // POS Phase E — Loyalty + Store Credit + Customer Tabs (P7)
  'LoyaltyProgram',
  'LoyaltyLedger',
  'StoreCredit',
  'StoreCreditLedger',
  'CustomerTab',
  'CustomerTabLedger',
  // POS — Menu Management (categories, items, ingredient links)
  'MenuCategory',
  'MenuItem',
  'MenuProduct',
  // POS Phase F — Digital Menu (Phase 1 MVP)
  'MenuQrSession',
  'OnlineOrder',
  // POS Phase T1 — Tables Management (ADR-012)
  'PosTable',
  'PosTableZone',
  'PosTableOrder',
  'PosTableReservation',
  // POS Order → Invoice → Receipt domain (DDD split)
  'Order',
  'OrderItem',
  'OrderItemModifier',
  'Receipt',
  'ReceiptItem',
  // POS R2 — Invoice pulled out of Document
  'Invoice',
  'InvoiceItem',
  'InvoiceItemModifier',
  // POS — Split bills (dine-in bill splitting)
  'SplitBill',
  'SplitBillItem',
  // Standalone expenses (petty-cash / operating expenses)
  'Expense',
  'ExpenseCategory',
  'ExpensePayment',
  // Phase 4 — payment terms (AR/AP term master)
  'PaymentTerm',
  // Phase 4 — fiscal positions (sales tax-treatment label master)
  'FiscalPosition',
  // Manufacturing — BOM + production orders. Omitting any of these is a
  // cross-tenant data leak, not a bug.
  'Bom',
  'BomLine',
  'ProductionOrder',
  'ProductionMaterial',
  'ProductionOutput',
  // Manufacturing Phase 2 — requests, planning, QC.
  'ProductionRequest',
  'ProductionRequestLine',
  'ProductionPlan',
  'ProductionPlanLine',
  'ProductionQcCheck',
  // Manufacturing Phase 4 — work centres, resources, routing, work orders, costs.
  'WorkCenter',
  'Resource',
  'Routing',
  'RoutingOperation',
  'WorkOrder',
  'ProductionCostComponent',
  // Rental Management — every rental table carries organizationId. Omitting any
  // of these is a cross-tenant data leak, not a bug.
  'LifecycleEvent',
  'RentalRate',
  'RentalUnit',
  'RentalLocationConfig',
  'RentalPackage',
  'RentalPackageItem',
  'RentalReservation',
  'RentalReservationLine',
  'RentalAgreement',
  'RentalAgreementLine',
  'RentalBooking',
  'RentalExtension',
  'RentalSwap',
  'RentalReturn',
  'RentalReturnLine',
  'RentalDamage',
  'RentalServiceOrder',
  'RentalDeposit',
  'RentalDepositMovement',
  'RentalCustomerScore',
  // Repair & Maintenance (RMMS) — every repair table carries organizationId.
  // Omitting any of these is a cross-tenant data leak, not a bug.
  'RepairOrder',
  'RepairOrderItem',
  'RepairDiagnosis',
  'RepairQuotation',
  'RepairQuotationLine',
  'RepairJob',
  'RepairLabourType',
  'RepairTechnician',
  'RepairPart',
  'RepairStatusHistory',
  'RepairAttachment',
  'RepairWarranty',
  'RepairWarrantyClaim',
  'RepairServiceContract',
  'RepairSchedule',
  // Workforce Management (HR) — every Hr model is org-scoped
  'HrDepartment',
  'HrPosition',
  'HrEmployee',
  'HrShift',
  'HrShiftAssignment',
  'HrAttendance',
  'HrAttendanceLog',
  'HrTimesheet',
  'HrTimesheetEntry',
  'HrLeaveType',
  'HrLeaveBalance',
  'HrLeaveRequest',
  'HrLeaveAccrual',
  'HrHoliday',
  'HrPayrollComponent',
  'HrTaxTable',
  'HrTaxBracket',
  'HrPayrollPeriod',
  'HrPayrollRun',
  'HrPayrollItem',
  'HrPayrollAllowance',
  'HrPayrollDeduction',
  'HrPayrollInput',
  'HrPayslip',
  'HrSalaryAdvance',
  'HrEmployeeLoan',
  'HrBankPayment',
  'HrBankPaymentLine',
  'HrPerformanceReview',
  // HR Phase 1+ — salary structures, lifecycle, recruitment, training, statutory
  'HrJobGrade',
  'HrSalaryStructure',
  'HrSalaryChange',
  'HrEmploymentAction',
  'HrContract',
  'HrOnboardingTask',
  'HrOffboarding',
  'HrVacancy',
  'HrApplicant',
  'HrInterview',
  'HrQualification',
  'HrCertification',
  'HrTraining',
  'HrTrainingEnrollment',
  'HrStatutoryConfig',
  'HrEmployeeAuditTrail',
  'HrSkill',
  'HrEmployeeSkill',
  'HrExperience',
  'HrEmployeeDocument',
  // Communication platform — every model carries a non-null organizationId.
  // Omitting any one is a cross-tenant leak (someone reads another org's
  // messages by id), not a bug. The Baileys session manager + dispatch worker
  // reach across orgs deliberately via prisma.raw, which bypasses this
  // extension, so scoping the typed client here does not affect them.
  'CommunicationChannel',
  'Conversation',
  'ConversationChannel',
  'ExternalIdentity',
  'ConversationParticipant',
  'Message',
  'MessageAttachment',
  'MessageDelivery',
  'ExternalMessage',
  'WhatsAppAuthState',
  'MessageTemplate',
  'CommunicationRule',
  'CommunicationDispatch',
  'MessagingConsent',
  'MessageBroadcast',
  'BroadcastRecipient',
  // School vertical (P0.4). Kept in schema declaration order so the list can be
  // diffed against the schema block by eye; `tenancy-registration.spec.ts`
  // proves it mechanically.
  'Campus',
  'SchoolProfile',
  'AcademicYear',
  'Term',
  'Department',
  'GradeLevel',
  'SchoolClass',
  'Section',
  'Subject',
  'Period',
  'SchoolCalendarEvent',
  'StudentProfile',
  'StudentStatusHistory',
  'StudentGuardian',
  'MedicalRecord',
  'StudentDocument',
  'SchoolDoc',
  'SchoolDocVersion',
  'StaffProfile',
  'StaffStatusHistory',
  'Position',
  'StaffAttendance',
  'AdmissionApplication',
  'ApplicationDocument',
  'EntranceExam',
  'Interview',
  'ApplicantScore',
  'AdmissionFee',
  'OfferLetter',
  'WaitingList',
  // Admissions Phase 2/3 — identity matching, cycles, capacity, criteria,
  // decisions. These were live cross-tenant read/write paths: e.g.
  // admissions.service.ts reviewIdentityMatch() and capacityStatus() look up
  // by id with no org predicate, so one school could read (and confirm/dismiss)
  // another school's applicant matches and capacity plan.
  'ApplicantIdentityMatch',
  'AdmissionCycle',
  'AdmissionCapacity',
  // Configurable admission workflow: org-scoped configuration read by the resolver
  // and assignable to cycles, so it must be tenant-filtered like the rest.
  'AdmissionWorkflow',
  'AdmissionCriteriaSet',
  'AdmissionCriterion',
  'AdmissionDecision',
  // Admissions Phase 1/2/3/5 — guardians, status history, requirements, reviewer
  // assignments, portal tokens, offer templates, enquiries. Each carries a
  // non-null organizationId; omitting any one is a cross-tenant leak.
  'AdmissionGuardian',
  'AdmissionStatusHistory',
  'AdmissionRequirement',
  'AdmissionReviewerAssignment',
  'AdmissionPortalToken',
  'AdmissionOfferTemplate',
  'AdmissionEnquiry',
  'Enrollment',
  'Curriculum',
  'CurriculumSubject',
  'SubjectCategory',
  'Stream',
  'StudentCategory',
  'Competency',
  'Topic',
  'Unit',
  'LearningObjective',
  'LessonPlanObjective',
  'EnrollmentHistory',
  'LessonPlan',
  'TeacherAssignment',
  'TimetableSlot',
  'StudentAttendance',
  'AttendanceStatusConfig',
  'AttendanceThreshold',
  'HomeworkAssignment',
  'HomeworkSubmission',
  'LearningResource',
  'Announcement',
  // LMS Phase 1
  'CourseOffering',
  'CourseOfferingTeacher',
  'CourseEnrollment',
  'LearningActivity',
  'LessonPlanActivity',
  'LessonPlanResource',
  'LessonPlanAssessment',
  'LessonPlanDifferentiation',
  'LessonPlanReflection',
  'LessonPlanTemplate',
  'LessonPlanReview',
  'LessonPlanRevision',
  'ScheduledLesson',
  'LessonDelivery',
  // Phase 3 — schemes of work, plan/outcome links, offering resources and the
  // evidence/follow-up trail a delivered lesson leaves behind.
  'SchemeOfWork',
  'SchemeOfWorkWeek',
  'SchemeOfWorkItem',
  'LessonPlanOutcome',
  'CourseOfferingResource',
  'LessonDeliveryEvidence',
  'LessonFollowUp',
  'Discussion',
  'DiscussionPost',
  'LearningOutcome',
  'StudentOutcomeAchievement',
  'LearningObjectiveEvidence',
  'LearningObjectiveProgress',
  'StudentCourseProgress',
  'ExamType',
  'Exam',
  'ExamSchedule',
  'GradeEntry',
  'GradingScale',
  'ReportCard',
  'ReportCardSettings',
  'AcademicTranscript',
  // Exam operations (A4)
  'ExamVenue',
  'ExamRegistration',
  'Invigilator',
  'InvigilatorAssignment',
  'QuestionPaper',
  // Assessment core (A1)
  'AssessmentPolicy',
  'AssessmentComponent',
  'Assessment',
  'AssessmentOutcome',
  'StudentAssessment',
  'MarkEntry',
  'MarkAdjustment',
  // Rosters + assignment evidence (A2)
  'AcademicRoster',
  'AcademicRosterMember',
  'Rubric',
  'RubricCriterion',
  'RubricLevel',
  'AssessmentRubricScore',
  'Assignment',
  'AssignmentSubmission',
  // Result spine (A3)
  'ResultProcessingRun',
  'ResultSet',
  'StudentSubjectResult',
  'StudentTermResult',
  'AmendmentRequest',
  // Examination operations + result integrity (Phase 5). None of these carry a
  // deletedAt: a candidate snapshot, an attendance record, an incident, a
  // custody event, a marked script, a moderation sample, a published report
  // document and a promotion decision are all evidence — they are superseded or
  // voided in place, never soft-deleted out of view.
  'ExamCandidateSnapshot',
  'ExamCandidateEntry',
  'ExamAttendance',
  'ExamIncident',
  'SpecialConsideration',
  'QuestionPaperCustodyEvent',
  'ScriptAllocation',
  'ModerationSample',
  'ModerationSampleItem',
  'ReportDocument',
  'PromotionDecision',
  // Statutory workflows (Phase 6). A candidate register is a list of children
  // with their national identifiers, so a missing registration here would be
  // the worst kind of cross-tenant read this file exists to prevent.
  'StudentExamReference',
  'StatutoryExportTemplate',
  'StatutoryExportRun',
  'AcademicReminderLog',
  // CBT engine (A5)
  'QuestionBank',
  'Question',
  'QuestionOption',
  'Paper',
  'PaperQuestion',
  'QuizAttempt',
  'QuizResponse',
  'AttemptEvent',
  // Certification (A6)
  'ExternalExamResult',
  'ExternalExamSubjectResult',
  'Certificate',
  'FeeStructure',
  'FeeSchedule',
  'FeeCategory',
  'StudentOptionalFee',
  'StudentFeeAssignment',
  'Discount',
  'Scholarship',
  'InstallmentPlan',
  'PenaltyRule',
  'Sponsorship',
  'Waiver',
  'WaiverCategory',
  'FeeCredit',
  // Fees & Finance production-hardening models (ADR-013). A model missing from
  // ORG_SCOPED is a silent cross-tenant leak, so these are registered the
  // moment they exist.
  'SchoolFeeInvoice',
  'FeeCreditAllocation',
  'MobileMoneyRequest',
  'PaymentGatewayAccount',
  'MobileMoneySettlement',
  'FeeAdjustment',
  'BillingRun',
  'BillingRunItem',
  'TermFinancialClose',
  'PaymentImportBatch',
  'PaymentImportRow',
  'FeeStructureVersion',
  'FeeItem',
  'FinancialRemediationBatch',
  'FinancialRemediationItem',
  'Budget',
  'SchoolCalendarEvent',
  'SchoolPolicy',
  'CustomField',
  'TeachingRoom',
  'TeacherAvailability',
  'TimetableRotation',
  'TimetableOverride',
  'PenaltyRun',
  'PenaltyAssessment',
  'BookMetadata',
  'BookCopy',
  'Borrowing',
  'Vehicle',
  'Route',
  'Stop',
  'RouteAssignment',
  'StudentTransportAssignment',
  // School Transport Management System (STMS) — all tables carry organizationId.
  'TransportSettings',
  'TransportZone',
  'TransportRouteVersion',
  'TransportRouteStop',
  'TransportCrewMember',
  'TransportCrewDocument',
  'TransportVehicleDocument',
  'TransportRequest',
  'TransportAuthorizedPerson',
  'TransportSpecialRequirement',
  'TransportSchedule',
  'TransportScheduleException',
  'TransportTrip',
  'TransportTripStop',
  'TransportTripPassenger',
  'TransportBoardingEvent',
  'TransportVehicleInspection',
  'TransportInspectionItem',
  'TransportTripEvent',
  'TransportFeePlan',
  'TransportFeePlanRate',
  'TransportDiscountRule',
  'TransportCharge',
  'TransportIncident',
  'TransportIncidentStudent',
  'TransportIncidentAction',
  'TransportEndOfTripCheck',
  'TransportDevice',
  'TransportLocationEvent',
  'TransportGeofence',
  'TransportGeofenceEvent',
  'TransportTrackingAlert',
  'TransportTripTrack',
  'Dormitory',
  'Room',
  'Bed',
  'HostelAllocation',
  'MealPlan',
  'MealAccount',
  'MealPurchase',
  'MealProgram',
  'MealType',
  'MealPlanEntitlement',
  'MealPlanAssignment',
  'MealSession',
  'MealAttendance',
  'MealMenu',
  'MealMenuItem',
  'MealRecipe',
  'MealRecipeIngredient',
  'MealProductionPlan',
  'MealProductionItem',
  'MealConsumption',
  'MealWaste',
  'MealAccountTransaction',
  'FrontDeskLog',
  'SchoolDashboardCache',

  // ── Registered by the tenancy-registration ratchet (was: unscoped) ──────
  // These models all carry a non-null organizationId but were never added to
  // ORG_SCOPED, so nothing injected the org on write and nothing filtered it
  // on read — one tenant could fetch another tenant's row by id. The whole
  // Moodle-shaped LMS vertical, the income module, complaints/phone calls and
  // `PortalIdentity` (the signed-in subject for every parent and pupil) were
  // in that state.
  'IncomeHead',
  'Income',
  'EmergencyContact',
  'Nationality',
  'Complaint',
  'PhoneCall',
  'LmsContext',
  'LmsRole',
  'LmsRoleAssignment',
  'CourseCategory',
  'CourseSection',
  'CourseModule',
  'ModResource',
  'ModUrl',
  'ModPage',
  'ModLabel',
  'ModFolder',
  'ModAssign',
  'ModForum',
  'ModForumSubscription',
  'CourseEnrolmentMethod',
  'CourseEnrolment',
  'LmsGroup',
  'LmsGrouping',
  'CourseModuleCompletion',
  'CourseCompletionCriteria',
  'AssessmentGradeOverride',
  'StudentAssessmentHistory',
  'ModQuiz',
  'QuestionCategory',
  'QuizSlot',
  'QuizOverride',
  'LmsEvent',
  'LmsBadge',
  'LmsBadgeAward',
  'ModChoice',
  'ModChoiceAnswer',
  'ModGlossary',
  'ModGlossaryEntry',
  'ModWiki',
  'ModWikiPage',
  'ModLesson',
  'ModLessonPage',
  'ModFeedback',
  'ModFeedbackItem',
  'ModFeedbackResponse',
  'ModWorkshop',
  'ModWorkshopSubmission',
  'ModWorkshopAllocation',
  'ModScorm',
  'ScormTrack',
  'ModLti',
  'ModH5p',
  'XapiStatement',
  'LmsFile',
  'ModAssignSubmission',
  'PortalIdentity',
  'LtiPlatformKey',
  'LtiLaunchSession',
  'ModLessonAttempt',

  // Academic structure configuration (ADR-028).
  'AcademicLevel',
  // Stream -> Section convergence ledger (ADR-029). Permanent provenance; never
  // soft-deleted, so it is ORG_SCOPED only.
  'StreamSectionMigrationMap',

  // Phase 1 — enrollment and grouping integrity (ADR-018 / ADR-019).
  'AcademicProgramme',
  'ProgrammeGradeLevel',
  'ClassCohort',
  'StudentEnrollment',
  'EnrollmentPlacement',
  'StudentEnrollmentEvent',
  'AcademicMigrationException',
]);

/**
 * Models with a `deletedAt` column → soft-delete filtering on reads/writes.
 * Exported for the same reason as ORG_SCOPED — see `tenancy-registration.spec.ts`.
 */
export const SOFT_DELETE = new Set<string>([
  // Academic structure configuration (ADR-028). A level that has carried grades
  // is deactivated, never deleted, so historical reports keep resolving it.
  'AcademicLevel',

  // Phase 1 — enrollment and grouping integrity (ADR-018 / ADR-019).
  'AcademicProgramme',
  'ClassCohort',

  // Phase 6 — statutory. A withdrawn candidate reference and a retired export
  // layout stay readable for enquiries, so both soft-delete rather than
  // vanish. Export RUNS are evidence and never delete at all.
  'StudentExamReference',
  'StatutoryExportTemplate',

  // Registered by the tenancy-registration ratchet: these carry `deletedAt`
  // but were not filtered, so soft-deleted rows kept being returned.
  'IncomeHead',
  'Income',
  'EmergencyContact',
  'CourseSection',
  'CourseModule',

  'User',
  'Role',
  'Partner',
  'PartnerCategory',
  'Contact',
  'Address',
  'Product',
  'ProductCategory',
  'UnitOfMeasure',
  'UomCategory',
  'Tax',
  'FiscalPeriod',
  'Branch',
  // F.8 — inventory masters carry deletedAt
  'Brand',
  'ProductVariant',
  // Phase 2 config/master (transactional records use status, not soft delete)
  'Account',
  'Journal',
  'AccountMapping',
  'BankAccount',
  // Phase 4 — inventory (locations are config; quants/batches/ledger are not soft-deleted)
  'InventoryLocation',
  // Count session header carries deletedAt (lines cascade with the session)
  'InventoryCountSession',
  // Beverage bottle-count header carries deletedAt (lines/readings cascade)
  'BottleCountSession',
  // M5 — cash register is config; sessions/movements use status, not soft-delete
  'CashRegister',
  // F.5 — Webhook endpoints are config; deliveries are immutable.
  'WebhookEndpoint',
  // F.6 — Procurement config (transactional records use status, not soft delete)
  'PurchaseRequest',
  'PurchaseOrder',
  'GoodsReceiptNote',
  // F.6 — Debit notes (config; lines are transactional)
  'DebitNote',
  // F.7 — Deals are config (transactional records use status)
  'Deal',
  // F.7 — Activities (CRM timeline) carry deletedAt and are soft-deleted like Deal.
  'Activity',
  // Standalone expenses — Expense + ExpenseCategory carry deletedAt
  // (ExpensePayment uses a status column, not soft delete).
  'Expense',
  'ExpenseCategory',
  // POS — Menu Configuration (variants, accompaniments, modifiers)
  'MenuItemVariant',
  'AccompanimentGroup',
  'AccompanimentOption',
  'ModifierGroup',
  'Modifier',
  'ProductModifierGroup',
  'MenuItemModifierGroup',
  'MenuItemAccompanimentGroup',
  'MenuItem',
  'MenuCategory',
  // POS — configurable table zones (categories) are a config master (soft delete)
  'PosTableZone',
  // POS KDS — configurable kitchen stations are a config master (soft delete)
  'KitchenStation',
  // Phase 4 — payment terms carry deletedAt (config master)
  'PaymentTerm',
  // Phase 4 — fiscal positions carry deletedAt (config master)
  'FiscalPosition',
  // Manufacturing — Bom carries deletedAt (a recipe master). The transactional
  // three (ProductionOrder/Material/Output) use status, matching StockOut.
  'Bom',
  // Phase 2 request/plan headers carry deletedAt (config-like); lines + QC don't.
  'ProductionRequest',
  'ProductionPlan',
  // Phase 4 masters carry deletedAt; operations/work-orders/cost-rows don't.
  'WorkCenter',
  'Resource',
  'Routing',
  // Rental — rate cards, units and packages are config masters (soft delete);
  // the transactional records (agreements, bookings, returns, deposits) use
  // status, matching StockOut.
  'RentalRate',
  'RentalUnit',
  'RentalPackage',
  // Repair — labour types, technicians, service contracts and preventive
  // schedules are config masters (soft delete); orders, quotations, jobs,
  // parts and warranties are transactional and use status.
  'RepairLabourType',
  'RepairTechnician',
  'RepairServiceContract',
  'RepairSchedule',
  // Workforce Management (HR) — config masters carry deletedAt. Transactional
  // lines/logs (attendance logs, tax brackets, payroll allowance/deduction
  // lines, bank-payment lines) are append-only and have no deletedAt column.
  'HrDepartment',
  'HrPosition',
  'HrEmployee',
  'HrShift',
  'HrShiftAssignment',
  'HrAttendance',
  'HrTimesheet',
  'HrTimesheetEntry',
  'HrLeaveType',
  'HrLeaveBalance',
  'HrLeaveRequest',
  'HrHoliday',
  'HrPayrollComponent',
  'HrTaxTable',
  'HrPayrollPeriod',
  'HrPayrollRun',
  'HrPayrollItem',
  'HrPayrollInput',
  'HrPayslip',
  'HrSalaryAdvance',
  'HrEmployeeLoan',
  'HrBankPayment',
  'HrPerformanceReview',
  // HR Phase 1+ — salary structures, lifecycle, recruitment, training, statutory
  'HrJobGrade',
  'HrSalaryStructure',
  'HrContract',
  'HrOnboardingTask',
  'HrOffboarding',
  'HrVacancy',
  'HrApplicant',
  'HrInterview',
  'HrQualification',
  'HrCertification',
  'HrTraining',
  'HrTrainingEnrollment',
  'HrStatutoryConfig',
  'HrSkill',
  'HrEmployeeSkill',
  'HrExperience',
  'HrEmployeeDocument',
  // NOTE: HrSalaryChange / HrEmploymentAction / HrEmployeeAuditTrail are
  // append-only ledgers (no deletedAt) — they stay in ORG_SCOPED only.
  // Communication — Conversation + Message carry deletedAt (soft delete). The
  // transactional records (deliveries, external-message sidecars, participants)
  // use status columns / hard cascade, not soft delete.
  'Conversation',
  'Message',
  // School vertical (P0.4) — configuration and roster entities are soft-deleted
  // so historical enrollments, invoices and grades keep resolving their names.
  // Transactional rows (attendance, grade entries, payments, penalty runs) are
  // not soft-deleted: they are corrected, not removed.
  'Campus',
  'AcademicYear',
  'Term',
  'Department',
  'GradeLevel',
  'SchoolClass',
  'Section',
  'Subject',
  'Period',
  'SchoolCalendarEvent',
  'StudentProfile',
  'StudentGuardian',
  'StaffProfile',
  'Position',
  'AdmissionApplication',
  // Admissions config masters carry deletedAt (offer templates + enquiries are
  // soft-deleted so historical offers/enquiries keep resolving their names).
  'AdmissionOfferTemplate',
  'AdmissionEnquiry',
  'Curriculum',
  // LMS Phase 1 — course offerings, activities, plan templates and discussions
  // all carry deletedAt; without them a soft-deleted row kept being returned.
  'CourseOffering',
  // Phase 3 — a retired scheme of work stays readable for past terms.
  'SchemeOfWork',
  'LearningActivity',
  'LessonPlanTemplate',
  'Discussion',
  'HomeworkAssignment',
  'LearningResource',
  'Announcement',
  'ExamType',
  'Exam',
  'GradingScale',
  // Exam operations (A4) — ExamVenue, Invigilator and QuestionPaper have a
  // deletedAt; ExamRegistration and InvigilatorAssignment do not.
  'ExamVenue',
  'Invigilator',
  'QuestionPaper',
  // Assessment core (A1) — the four with a deletedAt column. MarkEntry and
  // MarkAdjustment are append-only ledgers with no deletedAt.
  'AssessmentPolicy',
  'AssessmentComponent',
  'Assessment',
  'StudentAssessment',
  // Rosters + assignments (A2) — soft-deletable parents only.
  'AcademicRoster',
  'Rubric',
  'Assignment',
  // Result spine (A3) — ResultSet is the only soft-deletable one; the child
  // result rows and the run/amendment ledgers have no deletedAt.
  'ResultSet',
  // CBT (A5) — the three authoring parents have deletedAt; attempts/responses/
  // events do not (attempts are historical records, events are append-only).
  'QuestionBank',
  'Question',
  'Paper',
  // Certification (A6) — ExternalExamResult has deletedAt; Certificate does not
  // (a certificate is revoked/voided, never soft-deleted).
  'ExternalExamResult',
  'FeeStructure',
  'FeeCategory',
  'Discount',
  'Scholarship',
  'SchoolPolicy',
  'CustomField',
  'LearningOutcome',
  'StudentTransportAssignment',
  'Vehicle',
  'Route',
  'Stop',
  // STMS roots (config-ish masters soft-deleted so history resolves names).
  // NOTE: TransportSettings and TransportTrip are deliberately absent — they
  // carry no deletedAt column, and listing them here made the extension
  // inject `deletedAt: null` into a column that does not exist.
  'TransportZone',
  'TransportRouteVersion',
  'TransportCrewMember',
  'TransportSchedule',
  'TransportFeePlan',
  'TransportIncident',
  'TransportGeofence',
  'TransportDevice',
  'Dormitory',
  'Room',
  'MealPlan',
  'MealProgram',
  'MealType',
  'MealSession',
  'MealMenu',
  'MealRecipe',
  'MealProductionPlan',
  // Academic Management foundation (2026-08-15) — new soft-deletable masters
  'SubjectCategory',
  'Stream',
  'Competency',
  'Topic',
  'LearningObjective',
  'LessonPlanObjective',
  'Unit',
]);

const WHERE_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

export function isOrgScoped(model: string): boolean {
  return ORG_SCOPED.has(model);
}

/**
 * SEC-02 — raised when a write payload names an organization other than the
 * request's own. A 403 rather than a 500: the request is well-formed, it is
 * simply not permitted.
 */
export class CrossTenantWriteError extends ForbiddenException {
  constructor(path: string, supplied: unknown, expected: string) {
    super(
      `Cross-tenant write rejected at ${path}: payload names organization ` +
        `'${String(supplied)}' but the request belongs to '${expected}'.`,
    );
  }
}

/**
 * Reject an explicit foreign organizationId anywhere in a write payload,
 * including nested relation writes.
 *
 * The extension only sees the TOP-LEVEL model, so it cannot resolve which model
 * a `data.x.create` belongs to and therefore cannot stamp nested creates — that
 * gap is unchanged and relies on Prisma inheriting the parent foreign key. What
 * it can do, and now does, is refuse a payload that explicitly names someone
 * else's organization at any depth. Stamping is best-effort; refusing is not.
 *
 * Only write payloads are walked. `where` clauses legitimately carry an
 * organizationId — the caller's is overwritten with the request's anyway.
 */
function assertNoForeignOrg(node: unknown, organizationId: string, path: string, depth = 0): void {
  // Prisma nests deeply on connectOrCreate chains; 8 covers real payloads
  // without turning a pathological object into a stack overflow.
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (node instanceof Date) return;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      assertNoForeignOrg(node[i], organizationId, `${path}[${i}]`, depth + 1);
    }
    return;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'organizationId') {
      // `undefined` means "not supplied"; `{ set: x }` is Prisma's update form.
      const supplied =
        value !== null && typeof value === 'object' && 'set' in (value as Record<string, unknown>)
          ? (value as Record<string, unknown>).set
          : value;
      if (supplied !== undefined && supplied !== null && supplied !== organizationId) {
        throw new CrossTenantWriteError(`${path}.${key}`, supplied, organizationId);
      }
      continue;
    }
    assertNoForeignOrg(value, organizationId, `${path}.${key}`, depth + 1);
  }
}

/**
 * Pure transform that injects organizationId (and a soft-delete filter) into a
 * Prisma operation's args. Exported for unit testing; the extension below wraps
 * it. Returns the (mutated) args.
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: unknown,
  organizationId: string,
): Record<string, unknown> {
  const orgScoped = ORG_SCOPED.has(model);
  const softDelete = SOFT_DELETE.has(model);
  const a = (args ?? {}) as Record<string, unknown>;
  if (!orgScoped && !softDelete) return a;

  if (operation === 'create') {
    const data = (a.data ?? {}) as Record<string, unknown>;
    if (orgScoped) {
      // SEC-02: was `if (data.organizationId === undefined)`, so a caller-supplied
      // value won and the extension deferred to it. Now the request's tenant is
      // authoritative and a conflicting value is refused outright.
      assertNoForeignOrg(data, organizationId, `${model}.data`);
      data.organizationId = organizationId;
    }
    a.data = data;
  } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
    if (orgScoped) {
      // SEC-02: spread order was `{ organizationId, ...d }`, so any
      // `d.organizationId` overrode the injected one. Reversed, plus the check.
      const stamp = (d: Record<string, unknown>, i: number): Record<string, unknown> => {
        assertNoForeignOrg(d, organizationId, `${model}.data[${i}]`);
        return { ...d, organizationId };
      };
      if (Array.isArray(a.data)) {
        a.data = a.data.map((d: Record<string, unknown>, i: number) => stamp(d, i));
      } else if (a.data) {
        a.data = stamp(a.data as Record<string, unknown>, 0);
      }
    }
  } else if (WHERE_OPS.has(operation)) {
    const where = (a.where ?? {}) as Record<string, unknown>;
    if (orgScoped) where.organizationId = organizationId;
    if (softDelete && operation !== 'upsert' && where.deletedAt === undefined) {
      where.deletedAt = null;
    }
    a.where = where;

    if (orgScoped) {
      if (operation === 'upsert') {
        // SEC-02: only `where` was scoped. The `create:` payload was never
        // stamped, which is why MedicalRecordService's hand-rolled
        // organization lookup was load-bearing — that value was what actually
        // landed on the row.
        const create = (a.create ?? {}) as Record<string, unknown>;
        assertNoForeignOrg(create, organizationId, `${model}.create`);
        create.organizationId = organizationId;
        a.create = create;
        if (a.update !== undefined) {
          assertNoForeignOrg(a.update, organizationId, `${model}.update`);
        }
      } else if (a.data !== undefined) {
        // SEC-02: `update`/`updateMany` data was never inspected, so
        // organizationId was mutable through the scoped client — a row could be
        // moved to another tenant. Reassignment is never legitimate; reject it
        // rather than silently rewriting it.
        assertNoForeignOrg(a.data, organizationId, `${model}.data`);
      }
    }
  }

  return a;
}

/**
 * Central tenancy + soft-delete enforcement (ADR-004). Reads the current
 * organizationId from AsyncLocalStorage at query time, so a single extended
 * client serves every request.
 */
export function tenancyExtension(tenant: TenantContextService) {
  return Prisma.defineExtension({
    name: 'tenancy-soft-delete',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || (!ORG_SCOPED.has(model) && !SOFT_DELETE.has(model))) {
            return query(args);
          }
          const scoped = scopeArgs(model, operation, args, tenant.organizationId);
          return query(scoped);
        },
      },
    },
  });
}
