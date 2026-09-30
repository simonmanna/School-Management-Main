/**
 * Typed domain-event contract shared by publishers and subscribers (ADR-003).
 * Add new events here so the bus stays type-safe across modules.
 */

export const EVENTS = {
  // master data
  PartnerCreated: 'partner.created',
  PartnerUpdated: 'partner.updated',
  PartnerDeleted: 'partner.deleted',
  ProductCreated: 'product.created',
  ProductUpdated: 'product.updated',
  ProductDeleted: 'product.deleted',
  UserRegistered: 'user.registered',
  UserLoggedIn: 'user.logged_in',
  // accounting (Phase 2)
  JournalPosted: 'journal.posted',
  JournalReversed: 'journal.reversed',
  CashReceived: 'cash.received',
  CashPaid: 'cash.paid',
  BankTransfer: 'bank.transfer',
  // invoicing / AR (Phase 3)
  InvoiceCreated: 'invoice.created',
  InvoicePosted: 'invoice.posted',
  InvoicePaid: 'invoice.paid',
  InvoiceCancelled: 'invoice.cancelled',
  CreditNoteIssued: 'creditnote.issued',
  PaymentReceived: 'payment.received',
  PaymentAllocated: 'payment.allocated',
  // purchasing / AP
  BillPosted: 'bill.posted',
  BillCancelled: 'bill.cancelled',
  PaymentVoided: 'payment.voided',
  // inventory (Phase 4)
  StockReceived: 'stock.received',
  StockIssued: 'stock.issued',
  StockAdjusted: 'stock.adjusted',
  StockTransferred: 'stock.transferred',
  // M5 — cash sessions
  CashSessionOpened: 'cash.session.opened',
  CashSessionClosed: 'cash.session.closed',
  CashSessionReconciled: 'cash.session.reconciled',
  CashMovementRecorded: 'cash.movement.recorded',
  CashBankingRecorded: 'cash.banking.recorded',
  // D2-2 — period close
  FiscalPeriodClosed: 'fiscal_period.closed',
  FiscalPeriodLocked: 'fiscal_period.locked',
  FiscalPeriodReopened: 'fiscal_period.reopened',
  // Phase C — FX revaluation
  FxRevaluationRan: 'fx_revaluation.ran',
  // Phase D — bank reconciliation
  BankStatementImported: 'bank_statement.imported',
  BankReconciliationRan: 'bank_reconciliation.ran',
  // Phase F.6 — Procurement chain
  PurchaseRequestCreated: 'purchase_request.created',
  PurchaseRequestSubmitted: 'purchase_request.submitted',
  PurchaseRequestApproved: 'purchase_request.approved',
  PurchaseRequestRejected: 'purchase_request.rejected',
  PurchaseRequestConverted: 'purchase_request.converted',
  PurchaseOrderCreated: 'purchase_order.created',
  PurchaseOrderApproved: 'purchase_order.approved',
  PurchaseOrderSent: 'purchase_order.sent',
  PurchaseOrderCancelled: 'purchase_order.cancelled',
  GoodsReceiptPosted: 'goods_receipt.posted',
  GoodsReceiptCancelled: 'goods_receipt.cancelled',
  ThreeWayMatchComputed: 'three_way_match.computed',
  DebitNoteCreated: 'debit_note.created',
  DebitNotePosted: 'debit_note.posted',
  // DMS — generic document lifecycle (Phase 2 engine facts; one event per engine
  // action so posting/reversal/notification hooks can subscribe generically).
  DocumentCreated: 'document.created',
  DocumentSubmitted: 'document.submitted',
  DocumentApproved: 'document.approved',
  DocumentRejected: 'document.rejected',
  DocumentConfirmed: 'document.confirmed',
  DocumentIssued: 'document.issued',
  DocumentActivated: 'document.activated',
  DocumentExpired: 'document.expired',
  DocumentRevoked: 'document.revoked',
  DocumentPosted: 'document.posted',
  DocumentPaid: 'document.paid',
  DocumentClosed: 'document.closed',
  DocumentCancelled: 'document.cancelled',
  DocumentReversed: 'document.reversed',
  DocumentReissued: 'document.reissued',
  DocumentTerminated: 'document.terminated',
  DocumentArchived: 'document.archived',
  DocumentAmended: 'document.amended',
  // Phase F.6 — Push notifications
  PushSubscribed: 'push.subscribed',
  // POS vertical (Phase 8) — Phase A additions (sell loop)
  PosSaleCompleted: 'pos.sale.completed',
  PosRefundCompleted: 'pos.refund.completed',
  PosHoldCreated: 'pos.hold.created',
  PosHoldRecalled: 'pos.hold.recalled',
  PosHoldDeleted: 'pos.hold.deleted',
  PosOverrideApproved: 'pos.override.approved',
  PosVoidCompleted: 'pos.void.completed',
  PosReportGenerated: 'pos.report.generated',
  // POS Order → Invoice → Receipt domain (DDD split)
  PosOrderCreated: 'pos.order.created',
  PosOrderUpdated: 'pos.order.updated',
  PosOrderInvoiced: 'pos.order.invoiced',
  PosOrderClosed: 'pos.order.closed',
  PosOrderCancelled: 'pos.order.cancelled',
  PosInvoiceSettled: 'pos.invoice.settled',
  PosInvoiceCredited: 'pos.invoice.credited',
  PosInvoiceWrittenOff: 'pos.invoice.written_off',
  CheckoutCompensationFailed: 'pos.checkout.compensation_failed',
  StoreCreditReversalFailed: 'pos.store_credit.reversal_failed',
  // POS Phase T1 — Tables Management (ADR-012)
  PosTableCreated: 'pos.table.created',
  PosTableUpdated: 'pos.table.updated',
  PosTableDeleted: 'pos.table.deleted',
  PosTableStatusChanged: 'pos.table.status_changed',
  PosTableMerged: 'pos.table.merged',
  PosTableUnmerged: 'pos.table.unmerged',
  PosTableTransferred: 'pos.table.transferred',
  PosTableSplit: 'pos.table.split',
  PosTableCleaned: 'pos.table.cleaned',
  PosTableReservationCreated: 'pos.table.reservation_created',
  PosTableReservationSeated: 'pos.table.reservation_seated',
  PosTableReservationCancelled: 'pos.table.reservation_cancelled',
  PosTableReservationNoShow: 'pos.table.reservation_no_show',
  // Staff / RBAC management
  RoleCreated: 'role.created',
  RoleUpdated: 'role.updated',
  RoleDeleted: 'role.deleted',
  UserCreated: 'user.created',
  UserUpdated: 'user.updated',
  UserDeleted: 'user.deleted',
  UserPasswordReset: 'user.password_reset',
  UserUnlocked: 'user.unlocked',
  // Fixed Assets
  AssetCreated: 'fixed_asset.created',
  AssetUpdated: 'fixed_asset.updated',
  AssetDeleted: 'fixed_asset.deleted',
  AssetAssigned: 'fixed_asset.assigned',
  AssetTransferred: 'fixed_asset.transferred',
  AssetDisposed: 'fixed_asset.disposed',
  DepreciationRun: 'fixed_asset.depreciation_run',
  MaintenanceDue: 'fixed_asset.maintenance_due',
  WarrantyExpiring: 'fixed_asset.warranty_expiring',

  // ─── Business events (Phase A) ────────────────────────────────────────────
  // Immutable facts about the domain-neutral `Order` lifecycle, emitted by the
  // workflow engine (ADR-007) and recorded in `DomainEventLog`. Past tense: an
  // event names something that HAPPENED, unlike the transition `action` that
  // caused it.
  //
  // Distinct from the `pos.order.*` family above, which is the POS-specific
  // notification stream (SSE fan-out to the floor map) with its own payloads.
  // These are the ledger facts; those are UI nudges.
  OrderConfirmed: 'order.confirmed',
  OrderFulfillmentStarted: 'order.fulfillment_started',
  OrderCompleted: 'order.completed',
  OrderClosed: 'order.closed',
  OrderCancelled: 'order.cancelled',
  OrderReopened: 'order.reopened',
  OrderSuperseded: 'order.superseded',

  // Per-fulfillment-document facts. The `strategy` discriminates kitchen /
  // delivery / rental / repair / production, so a subscriber can react to
  // "some fulfillment finished" without knowing which module produced it —
  // this is what the Phase C inventory posting policy binds to.
  FulfillmentStarted: 'fulfillment.started',
  FulfillmentCompleted: 'fulfillment.completed',

  // Communication platform. `message.created` fires when a human/system message
  // is persisted (drives dispatch); `message.received` on inbound from an
  // external provider; `message.delivered`/`.failed` are the transport outcome.
  // `channel.status_changed` tracks provider connection health for the UI.
  CommunicationMessageCreated: 'communication.message.created',
  CommunicationMessageReceived: 'communication.message.received',
  CommunicationMessageDelivered: 'communication.message.delivered',
  CommunicationMessageFailed: 'communication.message.failed',
  CommunicationChannelStatusChanged: 'communication.channel.status_changed',

  // ─── School vertical ──────────────────────────────────────────────────────
  // The school module never talks to a notification provider. It publishes
  // these facts; `CommunicationRule` rows decide who hears about them and on
  // which channel. Any event that should be able to drive a rule must also be
  // listed in RULE_EVENTABLE (communication.subscriber.ts) — the rule engine
  // validates `CommunicationRule.eventName` against that catalog on write, so
  // an event missing from it can never fire a rule.
  //
  // Foundation
  SchoolProfileUpdated: 'school.profile.updated',
  SchoolAcademicYearSetCurrent: 'school.academic_year.set_current',
  SchoolTermSetCurrent: 'school.term.set_current',
  // People
  SchoolStudentCreated: 'school.student.created',
  SchoolStudentStatusChanged: 'school.student.status.changed',
  SchoolStudentPromoted: 'school.student.promoted',
  SchoolStaffCreated: 'school.staff.created',
  SchoolStaffStatusChanged: 'school.staff.status.changed',
  // HR → school. Approved leave is published so the timetable can project it
  // into TeacherAvailability and flag/cover the affected lessons. The event bus
  // is how HR reaches the school vertical: neither may import the other
  // (ADR-011), and this keeps that boundary intact.
  HrLeaveApproved: 'hr.leave.approved',
  HrLeaveCancelled: 'hr.leave.cancelled',
  // A leaver's offboarding was posted. The school vertical ends the staff
  // member's teaching access; HR has already disabled their login.
  HrEmployeeOffboarded: 'hr.employee.offboarded',
  // Admissions
  SchoolAdmissionSubmitted: 'school.admission.submitted',
  SchoolAdmissionUnderReview: 'school.admission.under_review',
  SchoolAdmissionScreened: 'school.admission.screened',
  SchoolAdmissionInterviewScheduled: 'school.admission.interview_scheduled',
  SchoolAdmissionInterviewed: 'school.admission.interviewed',
  SchoolAdmissionScored: 'school.admission.scored',
  SchoolAdmissionExamScheduled: 'school.admission.exam_scheduled',
  SchoolAdmissionAccepted: 'school.admission.accepted',
  SchoolAdmissionWaitlisted: 'school.admission.waitlisted',
  SchoolAdmissionOfferIssued: 'school.admission.offer_issued',
  SchoolAdmissionOfferAccepted: 'school.admission.offer_accepted',
  SchoolAdmissionOfferDeclined: 'school.admission.offer_declined',
  SchoolAdmissionFeeInvoiced: 'school.admission.fee_invoiced',
  SchoolAdmissionRejected: 'school.admission.rejected',
  SchoolAdmissionEnrolled: 'school.admission.enrolled',
  SchoolAdmissionWithdrawn: 'school.admission.withdrawn',
  // Academics
  SchoolLessonPlanPublished: 'school.lesson_plan.published',
  // Attendance + LMS
  SchoolAttendanceMarked: 'school.attendance.marked',
  SchoolAttendanceCorrected: 'school.attendance.corrected',
  SchoolAttendanceCorrectionRequested: 'school.attendance.correction_requested',
  SchoolHomeworkAssigned: 'school.homework.assigned',
  SchoolHomeworkGraded: 'school.homework.graded',
  SchoolAnnouncementPublished: 'school.announcement.published',
  // Examinations
  SchoolExamScheduled: 'school.exam.scheduled',
  SchoolExamPublished: 'school.exam.published',
  SchoolExamClosed: 'school.exam.closed',
  SchoolGradePosted: 'school.grade.posted',
  SchoolGradeApproved: 'school.grade.approved',
  SchoolGradeRejected: 'school.grade.rejected',
  SchoolReportCardGenerated: 'school.reportcard.generated',
  SchoolReportCardPublished: 'school.reportcard.published',
  // Curriculum versioning (Academic Management)
  SchoolCurriculumCreated: 'school.curriculum.created',
  SchoolCurriculumPublished: 'school.curriculum.published',
  SchoolCurriculumVersionCloned: 'school.curriculum.version_cloned',
  SchoolCurriculumArchived: 'school.curriculum.archived',
  // Student academic enrollment (historical entity)
  SchoolEnrollmentCreated: 'school.enrollment.created',
  SchoolEnrollmentEnded: 'school.enrollment.ended',
  SchoolEnrollmentReEnrolled: 'school.enrollment.re_enrolled',
  // Phase 1 canonical enrollment/placement spine (ADR-018).
  SchoolStudentEnrollmentCreated: 'school.student_enrollment.created',
  SchoolStudentEnrollmentStatusChanged: 'school.student_enrollment.status_changed',
  SchoolPlacementChanged: 'school.placement.changed',
  // Assessment core (A1)
  SchoolAssessmentStatusChanged: 'school.assessment.status_changed',
  SchoolMarksApproved: 'school.marks.approved',
  SchoolMarksModerated: 'school.marks.moderated',
  // Rosters + assignments (A2)
  SchoolRosterFrozen: 'school.roster.frozen',
  SchoolAssignmentPublished: 'school.assignment.published',
  SchoolAssignmentSubmitted: 'school.assignment.submitted',
  SchoolAssignmentGraded: 'school.assignment.graded',
  // Result spine (A3)
  SchoolResultsComputed: 'school.results.computed',
  SchoolResultsPublished: 'school.results.published',
  SchoolResultsLocked: 'school.results.locked',
  SchoolResultsAmended: 'school.results.amended',
  SchoolResultsAmendmentRejected: 'school.results.amendment_rejected',
  // Examination operations + result integrity (Phase 5)
  SchoolExamLifecycleChanged: 'school.exam.lifecycle_changed',
  SchoolExamCandidatesFrozen: 'school.exam.candidates_frozen',
  SchoolExamAttendanceRecorded: 'school.exam.attendance_recorded',
  SchoolExamIncidentRaised: 'school.exam.incident_raised',
  SchoolExamIncidentResolved: 'school.exam.incident_resolved',
  SchoolSpecialConsiderationDecided: 'school.exam.special_consideration_decided',
  SchoolQuestionPaperCustodyRecorded: 'school.exam.custody_recorded',
  SchoolScriptsAllocated: 'school.exam.scripts_allocated',
  SchoolScriptReconciled: 'school.exam.script_reconciled',
  SchoolModerationSampleDrawn: 'school.exam.moderation_sample_drawn',
  SchoolModerationCompleted: 'school.exam.moderation_completed',
  SchoolReportDocumentGenerated: 'school.report_document.generated',
  SchoolReportDocumentPublished: 'school.report_document.published',
  SchoolReportDocumentSuperseded: 'school.report_document.superseded',
  SchoolPromotionProposed: 'school.promotion.proposed',
  SchoolPromotionDecided: 'school.promotion.decided',
  SchoolPromotionApplied: 'school.promotion.applied',
  // CBT engine (A5)
  SchoolQuizAttemptStarted: 'school.quiz.attempt.started',
  SchoolQuizAttemptSubmitted: 'school.quiz.attempt.submitted',
  // Certification (A6)
  SchoolTranscriptIssued: 'school.transcript.issued',
  SchoolCertificateIssued: 'school.certificate.issued',
  SchoolCertificateRevoked: 'school.certificate.revoked',
  SchoolExternalResultRecorded: 'school.external_result.recorded',
  // Fees — the money flows through Document/Payment; these are observers.
  SchoolFeeInvoiceDrafted: 'school.fee.invoice.drafted',
  SchoolFeeInvoicePosted: 'school.fee.invoice.posted',
  SchoolFeeInvoiceOverdue: 'school.fee.invoice.overdue',
  SchoolFeePaymentRecorded: 'school.fee.payment.recorded',
  SchoolFeeRefundRecorded: 'school.fee.refund.recorded',
  SchoolPenaltyRunCompleted: 'school.fee.penalty.run',
  SchoolSponsorshipCreated: 'school.fee.sponsorship.created',
  SchoolWaiverApplied: 'school.fee.waiver.applied',
  SchoolFeeCreditCreated: 'school.fee.credit.created',
  SchoolFeeCreditApplied: 'school.fee.credit.applied',
  SchoolFeeAdjustmentPosted: 'school.fee.adjustment.posted',
  SchoolWaiverApproved: 'school.fee.waiver.approved',
  SchoolWaiverRejected: 'school.fee.waiver.rejected',
  SchoolBillingRunCompleted: 'school.fee.billing.completed',
  SchoolPaymentImportPosted: 'school.fee.import.batch.posted',
  SchoolTermClosed: 'school.fee.term.closed',
  SchoolTermReopened: 'school.fee.term.reopened',
  // Reversals (Phase 3). An allocation reversal moves NO cash — it un-settles
  // an invoice and returns value to the payment's unallocated balance. A
  // payment reversal unwinds a receipt that should never have existed. Neither
  // is a refund, which returns money that genuinely arrived.
  SchoolMomoSettled: 'school.fee.momo.settled',
  SchoolAllocationReversed: 'school.fee.allocation.reversed',
  SchoolPaymentReversed: 'school.fee.payment.reversed',
  // Library + transport
  SchoolBookBorrowed: 'school.library.borrowed',
  SchoolBookReturned: 'school.library.returned',
  SchoolBookOverdueFined: 'school.library.overdue',
  SchoolTransportAssigned: 'school.transport.assigned',
  // STMS (full module)
  SchoolTransportRequestSubmitted: 'school.transport.request.submitted',
  SchoolTransportRequestApproved: 'school.transport.request.approved',
  SchoolTransportRequestRejected: 'school.transport.request.rejected',
  SchoolTransportAssignmentChanged: 'school.transport.assignment.changed',
  SchoolTransportAssignmentEnded: 'school.transport.assignment.ended',
  SchoolTransportTripGenerated: 'school.transport.trip.generated',
  SchoolTransportTripDispatched: 'school.transport.trip.dispatched',
  SchoolTransportTripStarted: 'school.transport.trip.started',
  SchoolTransportTripDelayed: 'school.transport.trip.delayed',
  SchoolTransportTripCompleted: 'school.transport.trip.completed',
  SchoolTransportTripCancelled: 'school.transport.trip.cancelled',
  SchoolTransportTripAborted: 'school.transport.trip.aborted',
  SchoolTransportStudentBoarded: 'school.transport.student.boarded',
  SchoolTransportStudentDroppedOff: 'school.transport.student.dropped_off',
  SchoolTransportStudentNoShow: 'school.transport.student.no_show',
  SchoolTransportStopApproaching: 'school.transport.stop.approaching',
  SchoolTransportTripUnaccountedStudent: 'school.transport.trip.unaccounted_student',
  SchoolTransportInspectionFailed: 'school.transport.inspection.failed',
  SchoolTransportIncidentCreated: 'school.transport.incident.created',
  SchoolTransportIncidentEmergency: 'school.transport.incident.emergency',
  SchoolTransportDeviationDetected: 'school.transport.deviation.detected',
  SchoolTransportSpeedViolation: 'school.transport.speed.violation',
  SchoolTransportChargePosted: 'school.transport.charge.posted',
  SchoolTransportDocumentExpiring: 'school.transport.document.expiring',
  // Hostel + cafeteria
  SchoolHostelAllocated: 'school.hostel.allocated',
  SchoolMealTopUp: 'school.meal.topup',
  // Meals module (V1–V3)
  SchoolMealPlanAssigned: 'school.meal.plan.assigned',
  SchoolMealPlanChanged: 'school.meal.plan.changed',
  SchoolMealSessionOpened: 'school.meal.session.opened',
  SchoolMealAttendanceRecorded: 'school.meal.attendance.recorded',
  SchoolMealChargePosted: 'school.meal.charge.posted',
  SchoolMealWalletLowBalance: 'school.meal.wallet.low_balance',
  SchoolMealProductionPlanned: 'school.meal.production.planned',
} as const;

/** Payload emitted for a created/updated/deleted tenant entity. */
export interface EntityEventPayload {
  id: string;
  organizationId: string;
  actorId?: string;
}

export interface UserLoggedInPayload {
  userId: string;
  organizationId: string;
  at: string;
}

export interface JournalPostedPayload {
  organizationId: string;
  journalEntryId: string;
  entryNumber: string;
  sourceType?: string;
  sourceId?: string;
}

export interface JournalReversedPayload {
  organizationId: string;
  journalEntryId: string;
  reversalEntryId: string;
}

export interface TreasuryPayload {
  organizationId: string;
  journalEntryId: string;
  amount: string;
}

export interface DocumentEventPayload {
  organizationId: string;
  documentId: string;
  documentNumber: string;
}

export interface PaymentEventPayload {
  organizationId: string;
  paymentId: string;
  amount: string;
}

export interface PaymentAllocatedPayload {
  organizationId: string;
  paymentId: string;
  documentId: string;
  amount: string;
}

export interface StockEventPayload {
  organizationId: string;
  productId: string;
  locationId: string;
  ledgerCode: string;
  quantity: string;
  /** Unit cost at the time of the move (AVCO recompute, FIFO batch cost, or STANDARD). */
  unitCost?: string;
  /** Total monetary value (= unitCost × quantity). */
  totalValue?: string;
  /** New running-average cost after a receipt (AVCO only). */
  newRunningAverage?: string;
  /** Delta between counted and system quantity on adjustment. */
  delta?: string;
}

/** Maps every event name to its payload type. */
export interface DomainEventMap {
  'partner.created': EntityEventPayload;
  'partner.updated': EntityEventPayload;
  'partner.deleted': EntityEventPayload;
  'product.created': EntityEventPayload;
  'product.updated': EntityEventPayload;
  'product.deleted': EntityEventPayload;
  'user.registered': EntityEventPayload;
  'user.logged_in': UserLoggedInPayload;
  'journal.posted': JournalPostedPayload;
  'journal.reversed': JournalReversedPayload;
  'cash.received': TreasuryPayload;
  'cash.paid': TreasuryPayload;
  'bank.transfer': TreasuryPayload;
  'invoice.created': DocumentEventPayload;
  'invoice.posted': DocumentEventPayload;
  'invoice.paid': DocumentEventPayload;
  'invoice.cancelled': DocumentEventPayload;
  'creditnote.issued': DocumentEventPayload;
  'payment.received': PaymentEventPayload;
  'payment.allocated': PaymentAllocatedPayload;
  'bill.posted': DocumentEventPayload;
  'bill.cancelled': DocumentEventPayload;
  'payment.voided': PaymentEventPayload;
  'stock.received': StockEventPayload;
  'stock.issued': StockEventPayload;
  'stock.adjusted': StockEventPayload;
  'stock.transferred': StockEventPayload;
  'cash.session.opened': { organizationId: string; sessionId: string; cashRegisterId: string };
  'cash.session.closed': { organizationId: string; sessionId: string; expected: string; counted: string; variance: string };
  'cash.session.reconciled': { organizationId: string; sessionId: string; cashRegisterId: string };
  'cash.movement.recorded': { organizationId: string; sessionId: string; movementId: string; movementType: string; amount: string };
  'cash.banking.recorded': { organizationId: string; sessionId: string; amount: string; bankName: string };
  'fiscal_period.closed': { organizationId: string; periodId: string; periodName: string; closingEntryId: string; netIncome: string };
  'fiscal_period.locked': { organizationId: string; periodId: string; periodName: string };
  'fiscal_period.reopened': {
    organizationId: string;
    periodId: string;
    periodName: string;
    fromStatus: string;
    reason: string;
    reversedClosingEntryId: string | null;
  };
  'fx_revaluation.ran': { organizationId: string; asOf: string; revalued: number; totalGain: string };
  'bank_statement.imported': { organizationId: string; bankAccountId: string; imported: number; skipped: number };
  'bank_reconciliation.ran': { organizationId: string; bankAccountId: string; runId: string; matched: number; unmatched: number };
  'purchase_request.created': { organizationId: string; requestId: string; requestNumber: string };
  'purchase_request.submitted': { organizationId: string; requestId: string };
  'purchase_request.approved': { organizationId: string; requestId: string; approverId: string };
  'purchase_request.rejected': { organizationId: string; requestId: string; reason: string };
  'purchase_request.converted': { organizationId: string; requestId: string; purchaseOrderIds: string[] };
  'purchase_order.created': { organizationId: string; orderId: string; orderNumber: string; partnerId: string };
  'purchase_order.approved': { organizationId: string; orderId: string; approverId: string };
  'purchase_order.sent': { organizationId: string; orderId: string; sentAt: string };
  'purchase_order.cancelled': { organizationId: string; orderId: string; reason: string };
  'goods_receipt.posted': { organizationId: string; receiptId: string; receiptNumber: string; orderId: string };
  'goods_receipt.cancelled': { organizationId: string; receiptId: string; reason: string };
  'three_way_match.computed': { organizationId: string; purchaseOrderId: string; matched: number; mismatched: number; blocked: number };
  'debit_note.created': { organizationId: string; noteId: string; noteNumber: string; direction: 'outbound' | 'inbound' };
  'debit_note.posted': { organizationId: string; noteId: string; direction: 'outbound' | 'inbound'; amount: string };
  // DMS — generic document lifecycle facts (Phase 2 engine). Every engine action
  // emits `document.<action>`; subscribers (posting/reversal/notification hooks)
  // filter on `action`/`documentTypeCode` as needed.
  'document.created': DocumentLifecyclePayload;
  'document.submitted': DocumentLifecyclePayload;
  'document.approved': DocumentLifecyclePayload;
  'document.rejected': DocumentLifecyclePayload;
  'document.confirmed': DocumentLifecyclePayload;
  'document.issued': DocumentLifecyclePayload;
  'document.activated': DocumentLifecyclePayload;
  'document.expired': DocumentLifecyclePayload;
  'document.revoked': DocumentLifecyclePayload;
  'document.posted': DocumentLifecyclePayload;
  'document.paid': DocumentLifecyclePayload;
  'document.closed': DocumentLifecyclePayload;
  'document.cancelled': DocumentLifecyclePayload;
  'document.reversed': DocumentLifecyclePayload;
  'document.reissued': DocumentLifecyclePayload;
  'document.terminated': DocumentLifecyclePayload;
  'document.archived': DocumentLifecyclePayload;
  'document.amended': DocumentLifecyclePayload;
  'push.subscribed': { organizationId: string; userId: string; subscriptionId: string };
  'pos.sale.completed': { organizationId: string; invoiceId: string; invoiceNumber: string; cashSessionId?: string; total: string };
  'pos.refund.completed': { organizationId: string; invoiceId: string; creditNoteId: string; total: string };
  'pos.hold.created': { organizationId: string; holdId: string; name: string; total: string; heldById: string };
  'pos.hold.recalled': { organizationId: string; holdId: string; recalledById: string };
  'pos.hold.deleted': { organizationId: string; holdId: string };
  'pos.override.approved': { organizationId: string; approverId: string; overrideKind: 'discount' | 'void' | 'manual_refund'; referenceId?: string; amount?: string };
  'pos.void.completed': { organizationId: string; invoiceId?: string; documentLineId?: string; voidedById: string; reason?: string };
  'pos.report.generated': { organizationId: string; reportKind: 'x' | 'z' | 'hourly' | 'top_items' | 'variance'; cashSessionId?: string; asOf: string };
  'pos.order.created': { organizationId: string; orderId: string; orderNumber: string; tableId?: string };
  'pos.order.updated': { organizationId: string; orderId: string; version: number };
  'pos.order.invoiced': { organizationId: string; orderId: string; invoiceId: string; invoiceNumber: string };
  'pos.order.closed': { organizationId: string; orderId: string; invoiceId?: string };
  'pos.order.cancelled': { organizationId: string; orderId: string; reason?: string };
  'pos.invoice.settled': { organizationId: string; invoiceId: string; invoiceNumber: string; paymentMode: string };
  'pos.invoice.credited': { organizationId: string; invoiceId: string; invoiceNumber: string; partnerId: string; amount: string };
  'pos.invoice.written_off': { organizationId: string; invoiceId: string; invoiceNumber: string; amount: string };
  'pos.checkout.compensation_failed': { organizationId: string; invoiceId: string; paymentIds: string[] };
  'pos.store_credit.reversal_failed': { organizationId: string; invoiceId: string; amount: number };
  'pos.table.created': { organizationId: string; tableId: string; number: number; name: string };
  'pos.table.updated': { organizationId: string; tableId: string; changes: Record<string, unknown> };
  'pos.table.deleted': { organizationId: string; tableId: string };
  'pos.table.status_changed': { organizationId: string; tableId: string; from: string; to: string; reason?: string };
  'pos.table.merged': { organizationId: string; sourceId: string; targetId: string; orderIds: string[]; actorId: string };
  'pos.table.unmerged': { organizationId: string; tableId: string; actorId: string };
  'pos.table.transferred': { organizationId: string; sourceId: string; targetId: string; orderIds: string[]; actorId: string };
  'pos.table.split': { organizationId: string; sourceOrderId: string; newOrderIds: string[]; actorId: string };
  'pos.table.cleaned': { organizationId: string; tableId: string; actorId: string };
  'pos.table.reservation_created': { organizationId: string; reservationId: string; tableId: string; startAt: string; endAt: string };
  'pos.table.reservation_seated': { organizationId: string; reservationId: string; tableId: string; orderId?: string };
  'pos.table.reservation_cancelled': { organizationId: string; reservationId: string; tableId: string };
  'pos.table.reservation_no_show': { organizationId: string; reservationId: string; tableId: string };
  'role.created': EntityEventPayload;
  'role.updated': EntityEventPayload;
  'role.deleted': EntityEventPayload;
  'user.created': EntityEventPayload;
  'user.updated': EntityEventPayload;
  'user.deleted': EntityEventPayload;
  'user.password_reset': EntityEventPayload;
  'user.unlocked': EntityEventPayload;
  'product.restored': EntityEventPayload;
  // Fixed Assets
  'fixed_asset.created': EntityEventPayload;
  'fixed_asset.updated': EntityEventPayload;
  'fixed_asset.deleted': EntityEventPayload;
  'fixed_asset.assigned': { organizationId: string; assetId: string; assignedToId: string; assignedToType: string };
  'fixed_asset.transferred': { organizationId: string; assetId: string; fromLocation: string; toLocation: string };
  'fixed_asset.disposed': { organizationId: string; assetId: string; method: string; value: string };
  'fixed_asset.depreciation_run': { organizationId: string; period: string; entriesCount: number };
  'fixed_asset.maintenance_due': { organizationId: string; assetId: string; assetName: string; maintenanceId: string };
  'fixed_asset.warranty_expiring': { organizationId: string; assetId: string; assetName: string; daysLeft: number };

  // ─── Business events (Phase A) ────────────────────────────────────────────
  /** Every order-lifecycle fact carries the same shape; `action` is the
   *  workflow action that produced it (`confirm`, `complete`, `close`, …). */
  'order.confirmed': OrderLifecycleEventPayload;
  'order.fulfillment_started': OrderLifecycleEventPayload;
  'order.completed': OrderLifecycleEventPayload;
  'order.closed': OrderLifecycleEventPayload;
  'order.cancelled': OrderLifecycleEventPayload;
  'order.reopened': OrderLifecycleEventPayload;
  'order.superseded': OrderLifecycleEventPayload;

  'fulfillment.started': FulfillmentEventPayload;
  'fulfillment.completed': FulfillmentEventPayload;

  // Communication platform.
  'communication.message.created': CommunicationMessageEventPayload;
  'communication.message.received': CommunicationMessageEventPayload;
  'communication.message.delivered': CommunicationDeliveryEventPayload;
  'communication.message.failed': CommunicationDeliveryEventPayload;
  'communication.channel.status_changed': CommunicationChannelEventPayload;

  // School vertical. Every payload carries organizationId because subscribers
  // run inside the outbox worker with no tenant context and must re-establish
  // one before touching the DB (see communication.subscriber.ts).
  'school.profile.updated': { organizationId: string; profileId: string };
  'school.academic_year.set_current': { organizationId: string; academicYearId: string };
  'school.term.set_current': { organizationId: string; termId: string };
  'school.student.created': {
    organizationId: string;
    studentProfileId: string;
    partnerId: string;
    admissionNo: string;
  };
  'school.student.status.changed': {
    organizationId: string;
    studentProfileId: string;
    fromStatus: string;
    toStatus: string;
  };
  'school.student.promoted': {
    organizationId: string;
    studentProfileId: string;
    outcome: string;
    fromClassId: string | null;
    toClassId: string | null;
    fromTermId: string | null;
    toTermId: string | null;
    enrollmentId: string | null;
  };
  'school.staff.created': {
    organizationId: string;
    staffProfileId: string;
    partnerId: string;
    employeeNo: string;
  };
  'school.staff.status.changed': {
    organizationId: string;
    staffProfileId: string;
    fromStatus: string;
    toStatus: string;
  };
  'hr.employee.offboarded': {
    organizationId: string;
    employeeId: string;
    partnerId: string | null;
    userId: string | null;
    lastWorkingDay: string;
    /** HR offboarding reason (resignation, retirement, …); drives the school staff status. */
    reason?: string | null;
  };
  'hr.leave.approved': {
    organizationId: string;
    leaveRequestId: string;
    employeeId: string;
    /** Resolved through the Partner bridge; null when the employee is unbridged. */
    staffProfileId: string | null;
    startDate: string;
    endDate: string;
    leaveTypeName?: string;
  };
  'hr.leave.cancelled': {
    organizationId: string;
    leaveRequestId: string;
    employeeId: string;
    staffProfileId: string | null;
    startDate: string;
    endDate: string;
  };
  'school.admission.submitted': {
    organizationId: string;
    applicationId: string;
    applicationNumber: string;
  };
  'school.admission.under_review': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.screened': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.interview_scheduled': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.interviewed': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.exam_scheduled': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.scored': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.accepted': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.rejected': {
    organizationId: string;
    applicationId: string;
    reason?: string;
  };
  'school.admission.waitlisted': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.offer_issued': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.offer_accepted': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.offer_declined': { organizationId: string; applicationId: string; reason?: string };
  'school.admission.fee_invoiced': { organizationId: string; applicationId: string; invoiceId: string };
  'school.admission.enrolled': {
    organizationId: string;
    applicationId: string;
    studentProfileId: string;
    classId: string;
    termId: string;
  };
  'school.admission.withdrawn': { organizationId: string; applicationId: string };
  'school.lesson_plan.published': {
    organizationId: string;
    lessonPlanId: string;
    subjectId: string;
    classId?: string;
  };
  'school.attendance.marked': {
    organizationId: string;
    date: string;
    classId: string;
    periodId?: string | null;
    present: number;
    absent: number;
    late: number;
    entries: Array<{ studentProfileId: string; status: string; minutesLate: number; earlyDepartureMinutes?: number | null }>;
  };
  'school.attendance.corrected': {
    organizationId: string;
    studentProfileId: string;
    attendanceId: string;
    fromStatus: string;
    toStatus: string;
    note?: string | null;
  };
  'school.attendance.correction_requested': {
    organizationId: string;
    studentProfileId: string;
    date: string;
    requestedStatus: string;
  };
  'school.homework.assigned': {
    organizationId: string;
    assignmentId: string;
    classId: string;
    subjectId: string;
  };
  'school.homework.graded': {
    organizationId: string;
    submissionId: string;
    assignmentId: string;
    studentProfileId: string;
  };
  'school.announcement.published': {
    organizationId: string;
    announcementId: string;
    scope: string;
    classId?: string;
  };
  'school.exam.scheduled': { organizationId: string; examId: string; termId: string };
  'school.exam.published': { organizationId: string; examId: string };
  'school.exam.closed': { organizationId: string; examId: string };
  'school.grade.posted': {
    organizationId: string;
    examScheduleId: string;
    studentProfileId: string;
  };
  'school.grade.approved': {
    organizationId: string;
    examScheduleId: string;
    approvedById: string;
  };
  'school.grade.rejected': {
    organizationId: string;
    examScheduleId: string;
    rejectedById: string;
    reason: string;
  };
  'school.reportcard.generated': {
    organizationId: string;
    reportCardId: string;
    studentProfileId: string;
    termId: string;
  };
  'school.reportcard.published': {
    organizationId: string;
    reportCardId: string;
    studentProfileId: string;
    termId: string;
    published: boolean;
  };
  'school.curriculum.created': { organizationId: string; curriculumId: string; version: number };
  'school.curriculum.published': { organizationId: string; curriculumId: string; version: number };
  'school.curriculum.version_cloned': { organizationId: string; curriculumId: string; fromVersion: number; toVersion: number };
  'school.curriculum.archived': { organizationId: string; curriculumId: string; version: number };
  'school.enrollment.created': { organizationId: string; enrollmentId: string; studentProfileId: string };
  'school.enrollment.ended': { organizationId: string; enrollmentId: string; toStatus: string; reason: string };
  'school.enrollment.re_enrolled': { organizationId: string; enrollmentId: string };
  // Phase 1 canonical enrollment/placement spine (ADR-018 / ADR-019).
  'school.student_enrollment.created': {
    organizationId: string;
    enrollmentId: string;
    studentProfileId: string;
    academicYearId: string;
    programmeId: string;
    gradeLevelId: string;
    actorId: string | null;
    requestId: string | null;
  };
  'school.student_enrollment.status_changed': {
    organizationId: string;
    enrollmentId: string;
    studentProfileId: string;
    fromStatus: string;
    toStatus: string;
    reason: string;
    effectiveAt: Date;
    actorId: string | null;
    requestId: string | null;
  };
  'school.placement.changed': {
    organizationId: string;
    enrollmentId: string;
    studentProfileId: string;
    placementId: string;
    previousPlacementId: string | null;
    from: { classCohortId: string; sectionId: string | null; termId: string } | null;
    to: { classCohortId: string; sectionId: string | null; termId: string };
    movementReason: string;
    effectiveFrom: Date;
    actorId: string | null;
    requestId: string | null;
  };
  'school.assessment.status_changed': {
    organizationId: string;
    assessmentId: string;
    status: string;
  };
  'school.marks.approved': {
    organizationId: string;
    assessmentId: string;
    approvedById: string;
    count: number;
  };
  'school.marks.moderated': {
    organizationId: string;
    studentAssessmentId: string;
    kind: string;
    sequence: number;
  };
  'school.roster.frozen': {
    organizationId: string;
    rosterId: string;
    memberCount: number;
  };
  'school.assignment.published': {
    organizationId: string;
    assignmentId: string;
    assessmentId: string;
    fannedOut: number;
  };
  'school.assignment.submitted': {
    organizationId: string;
    assignmentId: string;
    studentProfileId: string;
    attemptNo: number;
    isLate: boolean;
  };
  'school.assignment.graded': {
    organizationId: string;
    assignmentId: string;
    studentProfileId: string;
    score: string;
  };
  'school.results.computed': {
    organizationId: string;
    resultSetId: string;
    termId: string;
    revision: number;
    studentCount: number;
  };
  'school.results.published': {
    organizationId: string;
    resultSetId: string;
    termId: string;
    revision: number;
  };
  'school.results.locked': {
    organizationId: string;
    resultSetId: string;
    termId: string;
    revision: number;
  };
  'school.results.amended': {
    organizationId: string;
    resultSetId: string;
    previousResultSetId: string;
    revision: number;
  };
  'school.results.amendment_rejected': {
    organizationId: string;
    amendmentId: string;
    resultSetId: string;
  };
  // ── Examination operations + result integrity (Phase 5) ──
  'school.exam.lifecycle_changed': {
    organizationId: string;
    examId: string;
    from: string;
    to: string;
    reason: string | null;
  };
  'school.exam.candidates_frozen': {
    organizationId: string;
    examId: string;
    snapshotId: string;
    revision: number;
    candidateCount: number;
  };
  'school.exam.attendance_recorded': {
    organizationId: string;
    examId: string;
    examScheduleId: string;
    recorded: number;
  };
  'school.exam.incident_raised': {
    organizationId: string;
    examId: string;
    incidentId: string;
    type: string;
    severity: string;
  };
  'school.exam.incident_resolved': {
    organizationId: string;
    examId: string;
    incidentId: string;
    status: string;
  };
  'school.exam.special_consideration_decided': {
    organizationId: string;
    examId: string;
    considerationId: string;
    status: string;
    studentProfileId: string;
    papersExempted: number;
  };
  'school.exam.custody_recorded': {
    organizationId: string;
    examId: string | null;
    questionPaperId: string;
    action: string;
  };
  'school.exam.scripts_allocated': {
    organizationId: string;
    examId: string;
    examScheduleId: string;
    markingMode: string;
    created: number;
  };
  'school.exam.script_reconciled': {
    organizationId: string;
    examId: string;
    examScheduleId: string;
    agreed: number;
    blocked: number;
  };
  'school.exam.moderation_sample_drawn': {
    organizationId: string;
    examId: string;
    examScheduleId: string;
    sampleId: string;
    sampleSize: number;
  };
  'school.exam.moderation_completed': {
    organizationId: string;
    examScheduleId: string;
    sampleId: string;
    status: string;
    outsideTolerance: number;
    adjusted: number;
  };
  'school.report_document.generated': {
    organizationId: string;
    reportDocumentId: string;
    studentProfileId: string;
    termId: string;
    resultSetId: string | null;
  };
  'school.report_document.published': {
    organizationId: string;
    reportDocumentId: string;
    studentProfileId: string;
    termId: string;
  };
  'school.report_document.superseded': {
    organizationId: string;
    reportDocumentId: string;
    supersededById: string;
    reason: string | null;
  };
  'school.promotion.proposed': {
    organizationId: string;
    resultSetId: string;
    termId: string;
    proposed: number;
    refreshed: number;
  };
  'school.promotion.decided': {
    organizationId: string;
    count: number;
  };
  'school.promotion.applied': {
    organizationId: string;
    resultSetId: string;
    applied: number;
    skipped: number;
  };
  'school.quiz.attempt.started': {
    organizationId: string;
    attemptId: string;
    studentProfileId: string;
    paperId: string;
  };
  'school.quiz.attempt.submitted': {
    organizationId: string;
    attemptId: string;
    studentProfileId: string;
    autoScore: string;
    manualPending: number;
  };
  'school.transcript.issued': {
    organizationId: string;
    transcriptId: string;
    studentProfileId: string;
  };
  'school.certificate.issued': {
    organizationId: string;
    certificateId: string;
    studentProfileId: string;
    type: string;
    serialNumber: string;
  };
  'school.certificate.revoked': {
    organizationId: string;
    certificateId: string;
    reason: string;
    voided: boolean;
  };
  'school.external_result.recorded': {
    organizationId: string;
    externalResultId: string;
    studentProfileId: string;
    level: string;
    year: number;
  };
  'school.fee.invoice.drafted': {
    organizationId: string;
    documentId: string;
    studentProfileId: string;
    amount: string;
  };
  'school.fee.invoice.posted': {
    organizationId: string;
    documentId: string;
    schoolFeeInvoiceId?: string;
    studentProfileId: string;
    amount: string;
  };
  'school.fee.invoice.overdue': {
    organizationId: string;
    documentId: string;
    studentProfileId: string;
    amount: string;
  };
  'school.fee.payment.recorded': {
    organizationId: string;
    paymentId: string;
    documentId: string;
    amount: string;
  };
  'school.fee.penalty.run': {
    organizationId: string;
    scheduleId: string;
    totalAssessed: string;
    invoiceIds: string[];
    penaltyRunId: string;
  };
  'school.fee.refund.recorded': {
    organizationId: string;
    paymentId: string;
    studentProfileId: string;
    amount: string;
    overpaymentCredit: string;
  };
  'school.fee.sponsorship.created': {
    organizationId: string;
    sponsorshipId: string;
    sponsorId: string;
    studentProfileId: string;
  };
  'school.fee.waiver.applied': {
    organizationId: string;
    waiverId: string;
    studentProfileId: string;
    amount: string;
  };
  'school.fee.credit.created': {
    organizationId: string;
    feeCreditId: string;
    studentProfileId: string;
    amount: string;
    source: string;
  };
  'school.fee.credit.applied': {
    organizationId: string;
    studentProfileId: string;
    totalApplied: string;
    appliedCreditIds: string[];
  };
  'school.fee.adjustment.posted': {
    organizationId: string;
    adjustmentId: string;
    studentProfileId: string;
    direction: string;
    amount: string;
  };
  'school.fee.waiver.approved': {
    organizationId: string;
    waiverId: string;
    studentProfileId: string;
    approvedById: string;
  };
  'school.fee.waiver.rejected': {
    organizationId: string;
    waiverId: string;
    studentProfileId: string;
    reason?: string;
  };
  'school.fee.billing.completed': {
    organizationId: string;
    billingRunId: string;
    postedCount: number;
    failedCount: number;
  };
  'school.fee.import.batch.posted': {
    organizationId: string;
    batchId: string;
    postedCount: number;
    totalAmount: string;
  };
  'school.fee.term.closed': {
    organizationId: string;
    termId: string;
    closedById: string;
  };
  'school.fee.term.reopened': {
    organizationId: string;
    termId: string;
    reopenedById: string;
    reason?: string;
  };
  'school.fee.momo.settled': {
    organizationId: string;
    requestId: string;
    studentProfileId: string;
    provider: string;
    amount: string;
    paymentId: string | null;
    /** True when the provider re-delivered a callback we had already posted. */
    replayed: boolean;
  };
  'school.fee.allocation.reversed': {
    organizationId: string;
    allocationId: string;
    paymentId: string;
    documentId: string;
    amount: string;
    reason: string;
  };
  'school.fee.payment.reversed': {
    organizationId: string;
    paymentId: string;
    reason: string;
    reversedAllocations: number;
  };
  'school.library.borrowed': {
    organizationId: string;
    borrowingId: string;
    bookCopyId: string;
    studentProfileId?: string;
  };
  'school.library.returned': { organizationId: string; borrowingId: string };
  'school.library.overdue': {
    organizationId: string;
    borrowingId: string;
    fineAmount: string;
  };
  'school.transport.assigned': {
    organizationId: string;
    assignmentId: string;
    studentProfileId: string;
    routeId: string;
  };
  // STMS (full module)
  'school.transport.request.submitted': { organizationId: string; requestId: string; studentProfileId: string };
  'school.transport.request.approved': { organizationId: string; requestId: string; assignmentId?: string; studentProfileId: string };
  'school.transport.request.rejected': { organizationId: string; requestId: string; studentProfileId: string };
  'school.transport.assignment.changed': { organizationId: string; assignmentId: string; studentProfileId: string };
  'school.transport.assignment.ended': { organizationId: string; assignmentId: string; studentProfileId: string };
  'school.transport.trip.generated': { organizationId: string; tripId: string; scheduleId?: string };
  'school.transport.trip.dispatched': { organizationId: string; tripId: string; vehicleId?: string; driverCrewId?: string };
  'school.transport.trip.started': { organizationId: string; tripId: string };
  'school.transport.trip.delayed': { organizationId: string; tripId: string; delayMinutes: number };
  'school.transport.trip.completed': { organizationId: string; tripId: string };
  'school.transport.trip.cancelled': { organizationId: string; tripId: string };
  'school.transport.trip.aborted': { organizationId: string; tripId: string };
  'school.transport.student.boarded': { organizationId: string; tripId: string; studentProfileId: string; stopId?: string };
  'school.transport.student.dropped_off': { organizationId: string; tripId: string; studentProfileId: string; stopId?: string };
  'school.transport.student.no_show': { organizationId: string; tripId: string; studentProfileId: string };
  'school.transport.stop.approaching': { organizationId: string; tripId: string; stopId: string; studentProfileId?: string; etaMinutes?: number };
  'school.transport.trip.unaccounted_student': { organizationId: string; tripId: string; studentProfileId: string };
  'school.transport.inspection.failed': { organizationId: string; inspectionId: string; vehicleId: string };
  'school.transport.incident.created': { organizationId: string; incidentId: string; tripId?: string; severity: string };
  'school.transport.incident.emergency': { organizationId: string; incidentId: string; tripId?: string };
  'school.transport.deviation.detected': { organizationId: string; tripId?: string; vehicleId: string; alertId?: string };
  'school.transport.speed.violation': { organizationId: string; tripId?: string; vehicleId: string; alertId?: string };
  'school.transport.charge.posted': { organizationId: string; chargeId: string; documentId: string; studentProfileId: string; amount: string };
  'school.transport.document.expiring': { organizationId: string; documentId: string; crewMemberId?: string; vehicleId?: string; expiryDate: string };
  'school.hostel.allocated': {
    organizationId: string;
    allocationId: string;
    studentProfileId: string;
    bedId: string;
  };
  'school.meal.topup': { organizationId: string; mealAccountId: string; amount: string };
  'school.meal.plan.assigned': {
    organizationId: string;
    assignmentId: string;
    studentProfileId: string;
    mealPlanId: string;
    termId: string;
  };
  'school.meal.plan.changed': {
    organizationId: string;
    assignmentId: string;
    studentProfileId: string;
    status: string;
  };
  'school.meal.session.opened': {
    organizationId: string;
    mealSessionId: string;
    mealTypeId: string;
    date: string;
    expectedCount: number;
  };
  'school.meal.attendance.recorded': {
    organizationId: string;
    mealSessionId: string;
    served: number;
    absent: number;
    excused: number;
  };
  'school.meal.charge.posted': {
    organizationId: string;
    documentId: string;
    studentProfileId: string;
    amount: string;
  };
  'school.meal.wallet.low_balance': {
    organizationId: string;
    mealAccountId: string;
    balance: string;
  };
  'school.meal.production.planned': {
    organizationId: string;
    mealProductionPlanId: string;
    mealTypeId: string;
    date: string;
    expectedPortions: number;
  };
}

/** A message was created (outbound) or received (inbound). */
export interface CommunicationMessageEventPayload {
  organizationId: string;
  messageId: string;
  conversationId: string;
  /** Inbound provider id, or 'internal' for staff-authored. */
  providerId: string;
  direction: 'inbound' | 'outbound';
  [key: string]: unknown;
}

/** A per-recipient delivery reached a terminal transport outcome. */
export interface CommunicationDeliveryEventPayload {
  organizationId: string;
  messageId: string;
  deliveryId: string;
  providerId: string;
  status: string;
  [key: string]: unknown;
}

/** A communication channel changed connection status. */
export interface CommunicationChannelEventPayload {
  organizationId: string;
  channelId: string;
  providerId: string;
  status: string;
  [key: string]: unknown;
}

/**
 * Emitted by `WorkflowService.transition` for a declared order transition.
 * `fromState`/`toState` make the fact self-describing without re-reading the row.
 */
export interface OrderLifecycleEventPayload {
  organizationId: string;
  orderId: string;
  fromState: string;
  toState: string;
  /** The workflow action that caused the transition. */
  action: string;
  [key: string]: unknown;
}

/**
 * Emitted by the DMS engine (Phase 2) for every document lifecycle action.
 * `fromStatus`/`toStatus` make the transition self-describing; `version` is the
 * document's post-action optimistic-lock value. `reason` is present on
 * cancel/reverse/terminate/revoke (guarded by requiresReason).
 */
export interface DocumentLifecyclePayload {
  organizationId: string;
  documentId: string;
  documentNumber?: string;
  documentTypeId: string;
  documentTypeCode: string;
  /** The engine action that produced this fact (submit, post, reverse, …). */
  action: string;
  fromStatus: string;
  toStatus?: string;
  actorId?: string;
  /** Post-action optimistic-lock version. */
  version: number;
  reason?: string;
  /** Present when the action created a reversal counterpart (credit/debit note). */
  counterpartId?: string;
  [key: string]: unknown;
}

/**
 * Emitted by a fulfillment document when it starts or finishes its work.
 * `strategy` is the module-declared code (`kitchen`, `delivery`, `rental`, …)
 * and `documentType`/`documentId` point at the concrete row, so a subscriber
 * can react generically or drill into the source.
 */
export interface FulfillmentEventPayload {
  organizationId: string;
  orderId: string;
  strategy: string;
  documentType: string;
  documentId: string;
  [key: string]: unknown;
}

export type DomainEventName = keyof DomainEventMap;

/**
 * Which entity a business event is ABOUT, so `DomainEventLog` can be indexed by
 * subject and queried as history (`@@index([organizationId, entityType, entityId])`).
 *
 * Only events listed here produce a ledger row. Everything else still reaches
 * the outbox for delivery — the outbox is transport, this map is what makes an
 * event part of the permanent record.
 */
export const EVENT_SUBJECT: Partial<Record<DomainEventName, { entityType: string; idField: string }>> = {
  'order.confirmed': { entityType: 'order', idField: 'orderId' },
  'order.fulfillment_started': { entityType: 'order', idField: 'orderId' },
  'order.completed': { entityType: 'order', idField: 'orderId' },
  'order.closed': { entityType: 'order', idField: 'orderId' },
  'order.cancelled': { entityType: 'order', idField: 'orderId' },
  'order.reopened': { entityType: 'order', idField: 'orderId' },
  'order.superseded': { entityType: 'order', idField: 'orderId' },
  // Fulfillment facts are filed against the ORDER, not the fulfillment document:
  // the milestone question is always "what happened to this order?", and the
  // concrete document is still recoverable from the payload.
  'fulfillment.started': { entityType: 'order', idField: 'orderId' },
  'fulfillment.completed': { entityType: 'order', idField: 'orderId' },
  // DMS — lifecycle facts are filed against the document itself, so the log is
  // queryable as per-document history.
  'document.created': { entityType: 'document', idField: 'documentId' },
  'document.submitted': { entityType: 'document', idField: 'documentId' },
  'document.approved': { entityType: 'document', idField: 'documentId' },
  'document.rejected': { entityType: 'document', idField: 'documentId' },
  'document.confirmed': { entityType: 'document', idField: 'documentId' },
  'document.issued': { entityType: 'document', idField: 'documentId' },
  'document.activated': { entityType: 'document', idField: 'documentId' },
  'document.expired': { entityType: 'document', idField: 'documentId' },
  'document.revoked': { entityType: 'document', idField: 'documentId' },
  'document.posted': { entityType: 'document', idField: 'documentId' },
  'document.paid': { entityType: 'document', idField: 'documentId' },
  'document.closed': { entityType: 'document', idField: 'documentId' },
  'document.cancelled': { entityType: 'document', idField: 'documentId' },
  'document.reversed': { entityType: 'document', idField: 'documentId' },
  'document.reissued': { entityType: 'document', idField: 'documentId' },
  'document.terminated': { entityType: 'document', idField: 'documentId' },
  'document.archived': { entityType: 'document', idField: 'documentId' },
  'document.amended': { entityType: 'document', idField: 'documentId' },
  // Communication — message facts are filed against the message so a
  // conversation's ledger history is queryable per-message.
  'communication.message.created': { entityType: 'communication_message', idField: 'messageId' },
  'communication.message.received': { entityType: 'communication_message', idField: 'messageId' },
  'communication.message.delivered': { entityType: 'communication_message', idField: 'messageId' },
  'communication.message.failed': { entityType: 'communication_message', idField: 'messageId' },
  };