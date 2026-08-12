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
  CashMovementRecorded: 'cash.movement.recorded',
  // D2-2 — period close
  FiscalPeriodClosed: 'fiscal_period.closed',
  FiscalPeriodLocked: 'fiscal_period.locked',
  // Phase C — FX revaluation
  FxRevaluationRan: 'fx_revaluation.ran',
  // Phase D — bank reconciliation
    BankStatementImported: 'bank_statement.imported',
    BankReconciliationRan: 'bank_reconciliation.ran',

    // ── School Vertical ────────────────────────────────────────────────
    // Foundation
    SchoolProfileUpdated: 'school.profile.updated',
    AcademicYearSetCurrent: 'school.academic_year.set_current',
    TermSetCurrent: 'school.term.set_current',

    // People
    StudentCreated: 'school.student.created',
    StudentStatusChanged: 'school.student.status.changed',
    StaffCreated: 'school.staff.created',
    StaffStatusChanged: 'school.staff.status.changed',

    // Admissions
    AdmissionSubmitted: 'school.admission.submitted',
    AdmissionUnderReview: 'school.admission.under_review',
    AdmissionExamScheduled: 'school.admission.exam_scheduled',
    AdmissionAccepted: 'school.admission.accepted',
    AdmissionRejected: 'school.admission.rejected',
    AdmissionEnrolled: 'school.admission.enrolled',
    AdmissionWithdrawn: 'school.admission.withdrawn',

    // Academics
    LessonPlanPublished: 'school.lesson_plan.published',

    // Attendance + LMS
    AttendanceMarked: 'school.attendance.marked',
    AttendanceCorrectionRequested: 'school.attendance.correction_requested',
    HomeworkAssigned: 'school.homework.assigned',
    HomeworkGraded: 'school.homework.graded',
    AnnouncementPublished: 'school.announcement.published',

    // Examinations
    ExamScheduled: 'school.exam.scheduled',
    ExamPublished: 'school.exam.published',
    ExamClosed: 'school.exam.closed',
    GradePosted: 'school.grade.posted',
    GradeApproved: 'school.grade.approved',
    ReportCardGenerated: 'school.reportcard.generated',

    // Fees (keystone — flows through Document/Payment, events are observers)
    FeeInvoiceDrafted: 'school.fee.invoice.drafted',
    FeeInvoicePosted: 'school.fee.invoice.posted',
    FeeInvoiceOverdue: 'school.fee.invoice.overdue',
    FeePaymentRecorded: 'school.fee.payment.recorded',
    PenaltyRunCompleted: 'school.fee.penalty.run',

    // Communication
    NotificationSent: 'school.notification.sent',
    MessageSent: 'school.message.sent',

    // Library + Transport
    BookBorrowed: 'school.library.borrowed',
    BookReturned: 'school.library.returned',
    BookOverdueFined: 'school.library.overdue',
    TransportAssigned: 'school.transport.assigned',

    // Hostel + Cafeteria
    HostelAllocated: 'school.hostel.allocated',
    MealTopUp: 'school.meal.topup',
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
  'cash.movement.recorded': { organizationId: string; sessionId: string; movementId: string; movementType: string; amount: string };
  'fiscal_period.closed': { organizationId: string; periodId: string; periodName: string; closingEntryId: string; netIncome: string };
  'fiscal_period.locked': { organizationId: string; periodId: string; periodName: string };
  'fx_revaluation.ran': { organizationId: string; asOf: string; revalued: number; totalGain: string };
    'bank_statement.imported': { organizationId: string; bankAccountId: string; imported: number; skipped: number };
    'bank_reconciliation.ran': { organizationId: string; bankAccountId: string; runId: string; matched: number; unmatched: number };

    // School vertical — small payloads; full entity lives in the row.
    'school.profile.updated': { organizationId: string; profileId: string };
    'school.academic_year.set_current': { organizationId: string; academicYearId: string };
    'school.term.set_current': { organizationId: string; termId: string };
    'school.student.created': { organizationId: string; studentProfileId: string; partnerId: string; admissionNo: string };
    'school.student.status.changed': { organizationId: string; studentProfileId: string; fromStatus: string; toStatus: string };
    'school.staff.created': { organizationId: string; staffProfileId: string; partnerId: string; employeeNo: string };
    'school.staff.status.changed': { organizationId: string; staffProfileId: string; fromStatus: string; toStatus: string };
    'school.admission.submitted': { organizationId: string; applicationId: string; applicationNumber: string };
    'school.admission.under_review': { organizationId: string; applicationId: string };
    'school.admission.exam_scheduled': { organizationId: string; applicationId: string };
    'school.admission.accepted': { organizationId: string; applicationId: string };
    'school.admission.rejected': { organizationId: string; applicationId: string; reason?: string };
    'school.admission.enrolled': { organizationId: string; applicationId: string; studentProfileId: string; classId: string; termId: string };
    'school.admission.withdrawn': { organizationId: string; applicationId: string };
    'school.lesson_plan.published': { organizationId: string; lessonPlanId: string; subjectId: string; classId?: string };
    'school.attendance.marked': { organizationId: string; date: string; classId: string; present: number; absent: number; late: number };
    'school.attendance.correction_requested': { organizationId: string; studentProfileId: string; date: string; requestedStatus: string };
    'school.homework.assigned': { organizationId: string; assignmentId: string; classId: string; subjectId: string };
    'school.homework.graded': { organizationId: string; submissionId: string; assignmentId: string; studentProfileId: string };
    'school.announcement.published': { organizationId: string; announcementId: string; scope: string; classId?: string };
    'school.exam.scheduled': { organizationId: string; examId: string; termId: string };
    'school.exam.published': { organizationId: string; examId: string };
    'school.exam.closed': { organizationId: string; examId: string };
    'school.grade.posted': { organizationId: string; examScheduleId: string; studentProfileId: string };
    'school.grade.approved': { organizationId: string; examScheduleId: string; approvedById: string };
    'school.reportcard.generated': { organizationId: string; reportCardId: string; studentProfileId: string; termId: string };
    'school.fee.invoice.drafted': { organizationId: string; documentId: string; studentProfileId: string; amount: string };
    'school.fee.invoice.posted': { organizationId: string; documentId: string; studentProfileId: string; amount: string };
    'school.fee.invoice.overdue': { organizationId: string; documentId: string; studentProfileId: string; amount: string };
    'school.fee.payment.recorded': { organizationId: string; paymentId: string; documentId: string; amount: string };
    'school.fee.penalty.run': { organizationId: string; scheduleId: string; totalAssessed: string; invoiceIds: string[]; penaltyRunId: string };
    'school.notification.sent': { organizationId: string; notificationId: string; channel: string; recipientType: string; recipientId: string };
    'school.message.sent': { organizationId: string; threadId: string; messageId: string; senderId: string };
    'school.library.borrowed': { organizationId: string; borrowingId: string; bookCopyId: string; studentProfileId?: string };
    'school.library.returned': { organizationId: string; borrowingId: string };
    'school.library.overdue': { organizationId: string; borrowingId: string; fineAmount: string };
    'school.transport.assigned': { organizationId: string; assignmentId: string; studentProfileId: string; routeId: string };
    'school.hostel.allocated': { organizationId: string; allocationId: string; studentProfileId: string; bedId: string };
    'school.meal.topup': { organizationId: string; mealAccountId: string; amount: string };
  }

export type DomainEventName = keyof DomainEventMap;
