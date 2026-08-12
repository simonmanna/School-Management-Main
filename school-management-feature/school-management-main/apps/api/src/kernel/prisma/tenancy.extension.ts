import { Prisma } from '@prisma/client';
import type { TenantContextService } from '../tenancy/tenant-context.service';

/**
 * Models that carry a (non-null) organizationId and must be auto-scoped.
 * NOTE: Setting has a nullable organizationId and is handled manually in
 * SettingsService, so it is intentionally excluded here.
 */
const ORG_SCOPED = new Set<string>([
  'User',
  'Role',
  'RefreshToken',
  'AuditLog',
  'Partner',
  'PartnerCategory',
  'Contact',
  'Address',
  'Product',
  'ProductCategory',
  'UnitOfMeasure',
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
  // Phase 4 — inventory
  'InventoryLocation',
  'StockItem',
  'InventoryBatch',
  'InventoryLedger',
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

    // ── School Vertical (org-scoped; soft delete handled per model) ───────────
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
    'StudentGuardian',
    'MedicalRecord',
    'StudentDocument',
    'StudentStatusHistory',
    'StaffProfile',
    'StaffStatusHistory',
    'Position',
    'StaffAttendance',
    'AdmissionApplication',
    'ApplicationDocument',
    'EntranceExam',
    'WaitingList',
    'Enrollment',
    'Curriculum',
    'LessonPlan',
    'TeacherAssignment',
    'TimetableSlot',
    'StudentAttendance',
    'HomeworkAssignment',
    'HomeworkSubmission',
    'LearningResource',
    'Announcement',
    'ExamType',
    'Exam',
    'ExamSchedule',
    'GradeEntry',
    'GradingScale',
    'ReportCard',
    'AcademicTranscript',
    'FeeStructure',
    'FeeSchedule',
    'StudentFeeAssignment',
    'Discount',
    'Scholarship',
    'InstallmentPlan',
    'PenaltyRule',
    'PenaltyRun',
    'NotificationTemplate',
    'Notification',
    'MessageThread',
    'Message',
    'BookMetadata',
    'BookCopy',
    'Borrowing',
    'Vehicle',
    'Route',
    'Stop',
    'RouteAssignment',
    'StudentTransportAssignment',
    'Dormitory',
    'Room',
    'Bed',
    'HostelAllocation',
    'MealPlan',
    'MealAccount',
    'MealPurchase',
    'SchoolDashboardCache',
  ]);

/** Models with a `deletedAt` column → soft-delete filtering on reads/writes. */
const SOFT_DELETE = new Set<string>([
  'User',
  'Role',
  'Partner',
  'PartnerCategory',
  'Contact',
  'Address',
  'Product',
  'ProductCategory',
  'UnitOfMeasure',
  'Tax',
  'FiscalPeriod',
  'Branch',
  // Phase 2 config/master (transactional records use status, not soft delete)
  'Account',
  'Journal',
  'AccountMapping',
  'BankAccount',
  // Phase 4 — inventory (locations are config; quants/batches/ledger are not soft-deleted)
  'InventoryLocation',
  // M5 — cash register is config; sessions/movements use status, not soft-delete
  'CashRegister',
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
    if (orgScoped && data.organizationId === undefined) data.organizationId = organizationId;
    a.data = data;
  } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
    if (orgScoped) {
      if (Array.isArray(a.data)) {
        a.data = a.data.map((d: Record<string, unknown>) => ({ organizationId, ...d }));
      } else if (a.data) {
        a.data = { organizationId, ...(a.data as Record<string, unknown>) };
      }
    }
  } else if (WHERE_OPS.has(operation)) {
    const where = (a.where ?? {}) as Record<string, unknown>;
    if (orgScoped) where.organizationId = organizationId;
    if (softDelete && operation !== 'upsert' && where.deletedAt === undefined) {
      where.deletedAt = null;
    }
    a.where = where;
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
