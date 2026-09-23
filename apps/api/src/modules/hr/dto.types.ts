/**
 * DTOs for the HR / Workforce module.
 *
 * Every `@Body()` in `hr.controller.ts` was `dto: any`. Nest skips the global
 * ValidationPipe (`whitelist + forbidNonWhitelisted + transform`, see
 * `main.ts`) entirely when the parameter metatype is `Object`/`any` — so every
 * HR write, including payroll amounts and bank account numbers, reached Prisma
 * completely unvalidated.
 *
 * These MUST be classes, not interfaces: an interface has no runtime metatype
 * and the pipe silently skips it (same trap documented in
 * `modules/school/fees/dto.types.ts`). Controllers import them as values.
 *
 * Convention, matching the fees module: money is `@IsNumber() @Min(0)`; ids are
 * plain strings; dates arrive as ISO strings and services do the `new Date()`.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Enum vocabularies (mirror the Hr* enums in schema.prisma) ────────────────

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CASUAL', 'PROBATION'] as const;
const PAY_FREQUENCIES = ['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;
const SHIFT_TYPES = ['MORNING', 'AFTERNOON', 'NIGHT', 'SPLIT', 'ROTATING', 'FLEXIBLE'] as const;
const ATTENDANCE_EVENT_TYPES = ['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END'] as const;
const ATTENDANCE_METHODS = ['PIN', 'RFID', 'QR', 'FACE', 'FINGERPRINT', 'MANUAL', 'APP'] as const;
const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EARLY_LEAVE', 'ON_LEAVE', 'OFF_DAY'] as const;
const TIMESHEET_WORK_TYPES = [
  'REPAIR', 'HOTEL', 'SCHOOL', 'RENTAL', 'CLEANING', 'MANUFACTURING', 'PROJECT', 'CUSTOMER', 'OTHER',
] as const;
const LINKED_ENTITY_TYPES = ['repair_order', 'task', 'rental_agreement', 'document', 'other'] as const;
const COMPONENT_TYPES = ['ALLOWANCE', 'DEDUCTION'] as const;
const CALC_METHODS = ['FIXED', 'PERCENTAGE'] as const;
const TAX_TYPES = ['PAYE', 'PENSION', 'SOCIAL_SECURITY', 'LOCAL'] as const;
const PERIOD_TYPES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM'] as const;
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE'] as const;
const BANK_PAYMENT_STATUSES = ['DRAFT', 'GENERATED', 'SENT', 'PAID', 'CANCELLED'] as const;
const DEDUCTION_CATEGORIES = ['PENSION', 'SOCIAL_SECURITY', 'INSURANCE', 'OTHER_PAYABLE', 'RECOVERY'] as const;
const CONTRIBUTION_BASES = ['GROSS', 'BASIC'] as const;
const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED'] as const;
const CONTRACT_TYPES = ['permanent', 'contract', 'temporary', 'probation', 'internship'] as const;
const CONTRACT_STATUSES = ['draft', 'active', 'expiring', 'expired', 'terminated'] as const;
const APPLICANT_STATUSES = ['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
const VACANCY_STATUSES = ['open', 'on_hold', 'closed', 'filled'] as const;
const ONBOARDING_STATUSES = ['pending', 'in_progress', 'done', 'skipped'] as const;
const QUALIFICATION_TYPES = ['degree', 'diploma', 'certificate', 'teaching_qual', 'license', 'professional', 'other'] as const;
const CERTIFICATION_STATUSES = ['active', 'expiring', 'expired', 'revoked'] as const;
const ENROLLMENT_STATUSES = ['enrolled', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
const STATUTORY_CONFIG_TYPES = ['PENSION', 'SOCIAL_SECURITY', 'LOCAL_TAX', 'INSURANCE', 'OVERTIME', 'OTHER'] as const;
const LEAVE_ACCRUAL_METHODS = ['ANNUAL_UPFRONT', 'MONTHLY', 'NONE'] as const;
const PAYROLL_INPUT_TYPES = ['BONUS', 'COMMISSION', 'ALLOWANCE', 'DEDUCTION', 'REIMBURSEMENT'] as const;
const PAYROLL_INPUT_STATUSES = ['PENDING', 'APPROVED', 'APPLIED', 'CANCELLED'] as const;

// ── Org masters ─────────────────────────────────────────────────────────────

export class CreateDepartmentDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreatePositionDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() gradeId?: string;
  @IsOptional() @IsNumber() @Min(0) defaultSalary?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePositionDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() gradeId?: string;
  @IsOptional() @IsNumber() @Min(0) defaultSalary?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateEmployeeDto {
  @IsOptional() @IsString() employeeCode?: string;
  @IsString() @IsNotEmpty() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn([...EMPLOYMENT_TYPES]) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsString() hireDate?: string;
  @IsOptional() @IsString() contractEndDate?: string;
  @IsOptional() @IsString() probationEndDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() supervisorId?: string;
  @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  @IsOptional() @IsNumber() @Min(0) hourlyRate?: number;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccountName?: string;
  @IsOptional() @IsString() bankAccountNumber?: string;
  @IsOptional() @IsString() mobileMoneyProvider?: string;
  @IsOptional() @IsString() mobileMoneyNumber?: string;
  @IsOptional() @IsString() taxNumber?: string;
  @IsOptional() @IsString() pensionNumber?: string;
  @IsOptional() @IsString() socialSecurityNumber?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() notes?: string;
  /**
   * Linking an employee to a login is an IDENTITY change, not a profile edit —
   * it is accepted on create (where the record is new) but deliberately absent
   * from `UpdateEmployeeDto`. Re-pointing an existing employee at a different
   * `User` goes through `POST /hr/employees/:id/link-user`, which is gated
   * separately and audited.
   */
  @IsOptional() @IsString() userId?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @IsNotEmpty() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsIn([...EMPLOYMENT_TYPES]) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsString() hireDate?: string;
  @IsOptional() @IsString() contractEndDate?: string;
  @IsOptional() @IsString() probationEndDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() supervisorId?: string;
  @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  @IsOptional() @IsNumber() @Min(0) hourlyRate?: number;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccountName?: string;
  @IsOptional() @IsString() bankAccountNumber?: string;
  @IsOptional() @IsString() mobileMoneyProvider?: string;
  @IsOptional() @IsString() mobileMoneyNumber?: string;
  @IsOptional() @IsString() taxNumber?: string;
  @IsOptional() @IsString() pensionNumber?: string;
  @IsOptional() @IsString() socialSecurityNumber?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() notes?: string;
  /**
   * Reason recorded on the `HrSalaryChange` / `HrEmploymentAction` rows when
   * this edit changes `baseSalary`. Ignored otherwise.
   */
  @IsOptional() @IsString() salaryChangeReason?: string;
}

/** Bind an employee record to a login account (or clear it with null). */
export class LinkEmployeeUserDto {
  @IsOptional() @IsString() userId?: string | null;
}

export class CreateShiftDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsIn([...SHIFT_TYPES]) shiftType?: (typeof SHIFT_TYPES)[number];
  /** 'HH:mm' local wall-clock, stored as a string. */
  @IsString() @IsNotEmpty() startTime!: string;
  @IsString() @IsNotEmpty() endTime!: string;
  @IsOptional() @IsString() breakStart?: string;
  @IsOptional() @IsString() breakEnd?: string;
  @IsOptional() @IsInt() @Min(0) graceMinutes?: number;
  @IsOptional() @IsInt() @Min(0) maxOvertimeMinutes?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() description?: string;
}

export class UpdateShiftDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...SHIFT_TYPES]) shiftType?: (typeof SHIFT_TYPES)[number];
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsString() breakStart?: string;
  @IsOptional() @IsString() breakEnd?: string;
  @IsOptional() @IsInt() @Min(0) graceMinutes?: number;
  @IsOptional() @IsInt() @Min(0) maxOvertimeMinutes?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() description?: string;
}

export class AssignShiftDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() shiftId!: string;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export class ClockDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsIn([...ATTENDANCE_EVENT_TYPES]) eventType!: (typeof ATTENDANCE_EVENT_TYPES)[number];
  @IsOptional() @IsString() timestamp?: string;
  @IsOptional() @IsIn([...ATTENDANCE_METHODS]) method?: (typeof ATTENDANCE_METHODS)[number];
  @IsOptional() @IsString() deviceId?: string;
  @IsOptional() @IsString() ipAddress?: string;
  @IsOptional() @IsNumber() gpsLat?: number;
  @IsOptional() @IsNumber() gpsLng?: number;
  @IsOptional() @IsString() note?: string;
  /** Overwrite an existing check-in/out instead of rejecting the duplicate. */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class UpsertManualAttendanceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsString() checkInAt?: string;
  @IsOptional() @IsString() checkOutAt?: string;
  @IsOptional() @IsIn([...ATTENDANCE_STATUSES]) status?: (typeof ATTENDANCE_STATUSES)[number];
  @IsOptional() @IsIn([...ATTENDANCE_METHODS]) source?: (typeof ATTENDANCE_METHODS)[number];
  @IsOptional() @IsString() notes?: string;
}

// ── Timesheets ──────────────────────────────────────────────────────────────

export class CreateTimesheetDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() periodStart!: string;
  @IsString() @IsNotEmpty() periodEnd!: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateTimesheetDto {
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
  @IsOptional() @IsString() notes?: string;
}

export class RejectDto {
  @IsOptional() @IsString() reason?: string;
}

export class CreateTimesheetEntryDto {
  @IsString() @IsNotEmpty() date!: string;
  @IsString() @IsNotEmpty() startAt!: string;
  @IsString() @IsNotEmpty() endAt!: string;
  @IsOptional() @IsIn([...TIMESHEET_WORK_TYPES]) workType?: (typeof TIMESHEET_WORK_TYPES)[number];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn([...LINKED_ENTITY_TYPES]) linkedEntityType?: (typeof LINKED_ENTITY_TYPES)[number];
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsBoolean() isBillable?: boolean;
}

export class UpdateTimesheetEntryDto {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
  @IsOptional() @IsIn([...TIMESHEET_WORK_TYPES]) workType?: (typeof TIMESHEET_WORK_TYPES)[number];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn([...LINKED_ENTITY_TYPES]) linkedEntityType?: (typeof LINKED_ENTITY_TYPES)[number];
  @IsOptional() @IsString() linkedEntityId?: string;
  @IsOptional() @IsBoolean() isBillable?: boolean;
}

// ── Leave ───────────────────────────────────────────────────────────────────

export class CreateLeaveTypeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsInt() @Min(0) daysPerYear?: number;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsInt() @Min(0) carryForwardDays?: number;
  @IsOptional() @IsInt() @Min(0) maxConsecutiveDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsIn(LEAVE_ACCRUAL_METHODS) accrualMethod?: (typeof LEAVE_ACCRUAL_METHODS)[number];
  @IsOptional() @IsInt() @Min(0) accrualStartsAfterMonths?: number;
  @IsOptional() @IsInt() @Min(0) carryForwardExpiryMonths?: number;
  @IsOptional() @IsInt() @Min(0) maxBalanceDays?: number;
  /** Unused days are paid out on exit (annual leave). */
  @IsOptional() @IsBoolean() isEncashable?: boolean;
}

export class UpdateLeaveTypeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) daysPerYear?: number;
  @IsOptional() @IsBoolean() isPaid?: boolean;
  @IsOptional() @IsInt() @Min(0) carryForwardDays?: number;
  @IsOptional() @IsInt() @Min(0) maxConsecutiveDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsIn(LEAVE_ACCRUAL_METHODS) accrualMethod?: (typeof LEAVE_ACCRUAL_METHODS)[number];
  @IsOptional() @IsInt() @Min(0) accrualStartsAfterMonths?: number;
  @IsOptional() @IsInt() @Min(0) carryForwardExpiryMonths?: number;
  @IsOptional() @IsInt() @Min(0) maxBalanceDays?: number;
  @IsOptional() @IsBoolean() isEncashable?: boolean;
}

// ── Leave accrual engine ─────────────────────────────────────────────

export class RunLeaveAccrualDto {
  /** Accrue as at this date. Defaults to today. Only CLOSED periods are granted. */
  @IsOptional() @IsString() asOf?: string;
  @IsOptional() @IsString() leaveTypeId?: string;
  @IsOptional() @IsString() employeeId?: string;
  /** Compute and return what WOULD be granted without writing anything. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class LeaveYearEndDto {
  /** The year being CLOSED. Defaults to last year. */
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class ExpireCarryForwardDto {
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsString() asOf?: string;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class LeaveAccrualLedgerQueryDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() leaveTypeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
}

export class AdjustLeaveBalanceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() leaveTypeId!: string;
  @IsInt() year!: number;
  /** Signed: a negative value claws days back. */
  @IsNumber() adjustedDays!: number;
  @IsOptional() @IsString() notes?: string;
}

export class CreateLeaveRequestDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() leaveTypeId!: string;
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
  /** Reject the request when the balance is insufficient (default: true). */
  @IsOptional() @IsBoolean() checkBalance?: boolean;
}

export class LeaveDecisionDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateHolidayDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
}

// ── Payroll configuration ───────────────────────────────────────────────────

export class CreatePayrollComponentDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsIn([...COMPONENT_TYPES]) componentType!: (typeof COMPONENT_TYPES)[number];
  @IsOptional() @IsIn([...CALC_METHODS]) calcMethod?: (typeof CALC_METHODS)[number];
  /** FIXED components only. */
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  /** PERCENTAGE components only — a PERCENT (30 = 30%), not a fraction. */
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  /** Scope filter, `key:value` — departmentId / positionId / employmentType. */
  @IsOptional() @IsString() appliesTo?: string;
  /** DEDUCTION components: where the credit posts. Null = legacy code-based classification. */
  @IsOptional() @IsIn([...DEDUCTION_CATEGORIES]) deductionCategory?: (typeof DEDUCTION_CATEGORIES)[number];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdatePayrollComponentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...COMPONENT_TYPES]) componentType?: (typeof COMPONENT_TYPES)[number];
  @IsOptional() @IsIn([...CALC_METHODS]) calcMethod?: (typeof CALC_METHODS)[number];
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  @IsOptional() @IsString() appliesTo?: string;
  /** DEDUCTION components: where the credit posts. Null = legacy code-based classification. */
  @IsOptional() @IsIn([...DEDUCTION_CATEGORIES]) deductionCategory?: (typeof DEDUCTION_CATEGORIES)[number];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * One band of a progressive tax table.
 *
 * `rate` here is a FRACTION (0.3 = 30%) — deliberately different from
 * `HrPayrollComponent.rate`, which is a percentage. `computeProgressive()`
 * multiplies by it directly. `toAmount` omitted means "and above".
 */
export class TaxBracketDto {
  @IsNumber() @Min(0) fromAmount!: number;
  @IsOptional() @IsNumber() @Min(0) toAmount?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  /** LOCAL tables: fixed ANNUAL charge for the band. */
  @IsOptional() @IsNumber() @Min(0) fixedAmount?: number;
}

export class CreateTaxTableDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsIn([...TAX_TYPES]) taxType!: (typeof TAX_TYPES)[number];
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** PAYE: do employee pension/social-security contributions reduce the PAYE base? (Uganda: no.) */
  @IsOptional() @IsBoolean() contributionsDeductible?: boolean;
  /** LOCAL: collection months, e.g. "7,8,9,10". */
  @IsOptional() @IsString() collectionMonths?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxBracketDto)
  brackets?: TaxBracketDto[];
}

export class UpdateTaxTableDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsIn([...TAX_TYPES]) taxType?: (typeof TAX_TYPES)[number];
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** PAYE: do employee pension/social-security contributions reduce the PAYE base? (Uganda: no.) */
  @IsOptional() @IsBoolean() contributionsDeductible?: boolean;
  /** LOCAL: collection months, e.g. "7,8,9,10". */
  @IsOptional() @IsString() collectionMonths?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TaxBracketDto)
  brackets?: TaxBracketDto[];
}

export class CreateStatutoryConfigDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsIn([...STATUTORY_CONFIG_TYPES]) configType?: (typeof STATUTORY_CONFIG_TYPES)[number];
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsNumber() @Min(0) employerRate?: number;
  @IsOptional() @IsIn([...CONTRIBUTION_BASES]) contributionBase?: (typeof CONTRIBUTION_BASES)[number];
  /** Monthly cap on the contribution base. */
  @IsOptional() @IsNumber() @Min(0) ceiling?: number;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateStatutoryConfigDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsIn([...STATUTORY_CONFIG_TYPES]) configType?: (typeof STATUTORY_CONFIG_TYPES)[number];
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsNumber() @Min(0) employerRate?: number;
  @IsOptional() @IsIn([...CONTRIBUTION_BASES]) contributionBase?: (typeof CONTRIBUTION_BASES)[number];
  /** Monthly cap on the contribution base. */
  @IsOptional() @IsNumber() @Min(0) ceiling?: number;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Payroll periods, runs, payslips, bank payments ──────────────────────────

export class CreatePayrollPeriodDto {
  @IsOptional() @IsString() periodCode?: string;
  @IsOptional() @IsIn([...PERIOD_TYPES]) periodType?: (typeof PERIOD_TYPES)[number];
  @IsString() @IsNotEmpty() startDate!: string;
  @IsString() @IsNotEmpty() endDate!: string;
}

export class UpdatePayrollPeriodDto {
  @IsOptional() @IsString() periodCode?: string;
  @IsOptional() @IsIn([...PERIOD_TYPES]) periodType?: (typeof PERIOD_TYPES)[number];
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsIn(['OPEN', 'CLOSED', 'LOCKED']) status?: 'OPEN' | 'CLOSED' | 'LOCKED';
}

export class CreatePayrollRunDto {
  @IsString() @IsNotEmpty() periodId!: string;
  @IsOptional() @IsString() paymentDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ReverseRunDto {
  @IsOptional() @IsString() reason?: string;
}

export class MarkPayslipPaidDto {
  @IsOptional() @IsIn([...PAYMENT_METHODS]) paymentMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() paidAt?: string;
}

export class ReasonDto {
  @IsOptional() @IsString() reason?: string;
}

export class GenerateBankPaymentDto {
  @IsString() @IsNotEmpty() runId!: string;
  @IsOptional() @IsIn([...PAYMENT_METHODS]) method?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() paymentDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateBankPaymentStatusDto {
  @IsIn([...BANK_PAYMENT_STATUSES]) status!: (typeof BANK_PAYMENT_STATUSES)[number];
  /** PAID only: the value date of the transfer. Defaults to the batch payment date. */
  @IsOptional() @IsString() paidAt?: string;
  @IsOptional() @IsString() fileName?: string;
  @IsOptional() @IsString() fileUrl?: string;
}

// ── Advances & loans ────────────────────────────────────────────────────────

// ── Ad-hoc payroll inputs ───────────────────────────────────────────

export class PayrollInputRowDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() periodId!: string;
  @IsIn(PAYROLL_INPUT_TYPES) inputType!: (typeof PAYROLL_INPUT_TYPES)[number];
  @IsString() @IsNotEmpty() name!: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreatePayrollInputDto extends PayrollInputRowDto {}

/** Bulk capture — a bonus list keyed off one memo lands as one request. */
export class CreatePayrollInputsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollInputRowDto)
  inputs!: PayrollInputRowDto[];
}

export class UpdatePayrollInputDto {
  @IsOptional() @IsIn(PAYROLL_INPUT_TYPES) inputType?: (typeof PAYROLL_INPUT_TYPES)[number];
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsNumber() @IsPositive() amount?: number;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ApprovePayrollInputsDto {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

export class CancelPayrollInputDto {
  @IsOptional() @IsString() reason?: string;
}

export class ListPayrollInputsQueryDto {
  @IsOptional() @IsString() periodId?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsIn(PAYROLL_INPUT_STATUSES) status?: (typeof PAYROLL_INPUT_STATUSES)[number];
  @IsOptional() @IsIn(PAYROLL_INPUT_TYPES) inputType?: (typeof PAYROLL_INPUT_TYPES)[number];
}

export class CreateAdvanceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsNumber() @IsPositive() amount!: number;
  @IsOptional() @IsInt() @IsPositive() installmentMonths?: number;
  @IsOptional() @IsString() notes?: string;
}

export class CreateLoanDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsNumber() @IsPositive() principal!: number;
  @IsOptional() @IsNumber() @Min(0) interestRate?: number;
  @IsOptional() @IsInt() @IsPositive() installmentsTotal?: number;
  /** Disburse through the ledger now, dated this day. Omit to disburse later. */
  @IsOptional() @IsString() disbursedAt?: string;
  @IsOptional() @IsIn([...PAYMENT_METHODS]) disbursementMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() notes?: string;
}

/**
 * A loan's balance moves only through payroll, reversal or write-off — never
 * by edit. The only status change allowed here is a write-off (DEFAULTED).
 */
export class UpdateLoanDto {
  @IsOptional() @IsIn(['DEFAULTED']) status?: 'DEFAULTED';
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}

export class DisburseLoanDto {
  @IsOptional() @IsString() disbursedAt?: string;
  @IsOptional() @IsIn([...PAYMENT_METHODS]) method?: (typeof PAYMENT_METHODS)[number];
}

export class WriteOffLoanDto {
  @IsString() @IsNotEmpty() reason!: string;
}

export class PayAdvanceDto {
  @IsOptional() @IsIn([...PAYMENT_METHODS]) paymentMethod?: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsString() paidAt?: string;
}

// ── Performance reviews ─────────────────────────────────────────────────────

export class CreateReviewDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsOptional() @IsString() reviewDate?: string;
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
  @IsOptional() @IsNumber() @Min(0) attendanceRate?: number;
  @IsOptional() @IsNumber() @Min(0) lateRate?: number;
  @IsOptional() @IsNumber() @Min(0) absenteeismDays?: number;
  @IsOptional() @IsInt() @Min(0) jobsCompleted?: number;
  @IsOptional() @IsNumber() @Min(0) billableHours?: number;
  @IsOptional() @IsNumber() @Min(0) overtimeHours?: number;
  @IsOptional() @IsNumber() @Min(0) kpiScore?: number;
  @IsOptional() @IsInt() @Min(0) rating?: number;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn([...REVIEW_STATUSES]) status?: (typeof REVIEW_STATUSES)[number];
}

export class UpdateReviewDto extends CreateReviewDto {
  @IsOptional() @IsString() declare employeeId: string;
}

// ── Grades, salary structures, contracts, lifecycle ─────────────────────────

export class CreateJobGradeDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsNumber() @Min(0) minSalary?: number;
  @IsOptional() @IsNumber() @Min(0) midSalary?: number;
  @IsOptional() @IsNumber() @Min(0) maxSalary?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateJobGradeDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsNumber() @Min(0) minSalary?: number;
  @IsOptional() @IsNumber() @Min(0) midSalary?: number;
  @IsOptional() @IsNumber() @Min(0) maxSalary?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateSalaryStructureDto {
  @IsString() @IsNotEmpty() gradeId!: string;
  @IsString() @IsNotEmpty() componentId!: string;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSalaryStructureDto {
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateContractDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  /** Required — `createContract` rejects a body without it. */
  @IsString() @IsNotEmpty() contractNumber!: string;
  @IsOptional() @IsIn([...CONTRACT_TYPES]) type?: (typeof CONTRACT_TYPES)[number];
  @IsString() @IsNotEmpty() startDate!: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  /** Free-form compensation snapshot stored as JSON on the contract. */
  @IsOptional() @IsObject() salary?: Record<string, unknown>;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsIn([...CONTRACT_STATUSES]) status?: (typeof CONTRACT_STATUSES)[number];
  @IsOptional() @IsString() signedAt?: string;
}

export class UpdateContractDto {
  @IsOptional() @IsIn([...CONTRACT_TYPES]) type?: (typeof CONTRACT_TYPES)[number];
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  @IsOptional() @IsObject() salary?: Record<string, unknown>;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsIn([...CONTRACT_STATUSES]) status?: (typeof CONTRACT_STATUSES)[number];
  @IsOptional() @IsString() signedAt?: string;
}

export class AddOnboardingTaskDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() task!: string;
  @IsOptional() @IsIn([...ONBOARDING_STATUSES]) status?: (typeof ONBOARDING_STATUSES)[number];
}

export class SettleOffboardingDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() lastDay!: string;
  @IsOptional() @IsIn(['resignation', 'termination', 'retirement', 'contract_expiry', 'redundancy', 'death', 'dismissal'])
  reason?: string;
  @IsOptional() @IsString() noticeDate?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Recruitment ─────────────────────────────────────────────────────────────

export class CreateVacancyDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsInt() @IsPositive() openings?: number;
  @IsOptional() @IsObject() salaryRange?: Record<string, unknown>;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsIn([...VACANCY_STATUSES]) status?: (typeof VACANCY_STATUSES)[number];
  @IsOptional() @IsString() description?: string;
}

export class UpdateVacancyDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsInt() @IsPositive() openings?: number;
  @IsOptional() @IsObject() salaryRange?: Record<string, unknown>;
  @IsOptional() @IsString() hiringManagerId?: string;
  @IsOptional() @IsIn([...VACANCY_STATUSES]) status?: (typeof VACANCY_STATUSES)[number];
  @IsOptional() @IsString() description?: string;
}

export class CreateApplicantDto {
  @IsString() @IsNotEmpty() vacancyId!: string;
  @IsString() @IsNotEmpty() firstName!: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() cvUrl?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsIn([...APPLICANT_STATUSES]) status?: (typeof APPLICANT_STATUSES)[number];
  @IsOptional() @IsInt() score?: number;
  @IsOptional() @IsString() notes?: string;
}

export class SetApplicantStatusDto {
  @IsIn([...APPLICANT_STATUSES]) status!: (typeof APPLICANT_STATUSES)[number];
  @IsOptional() @IsString() notes?: string;
}

export class AddInterviewDto {
  @IsString() @IsNotEmpty() applicantId!: string;
  @IsString() @IsNotEmpty() scheduledAt!: string;
  @IsOptional() @IsString() interviewerId?: string;
  @IsOptional() @IsInt() score?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateInterviewDto {
  @IsOptional() @IsString() scheduledAt?: string;
  @IsOptional() @IsString() interviewerId?: string;
  @IsOptional() @IsInt() score?: number;
  @IsOptional() @IsString() notes?: string;
}

/** Convert a hired applicant into an employee. Fields mirror CreateEmployeeDto. */
export class HireApplicantDto {
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
  @IsOptional() @IsString() supervisorId?: string;
  @IsOptional() @IsIn([...EMPLOYMENT_TYPES]) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsString() hireDate?: string;
  @IsOptional() @IsString() probationEndDate?: string;
  @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  @IsOptional() @IsString() notes?: string;
}

// ── Qualifications, certifications, training ────────────────────────────────

export class CreateQualificationDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsOptional() @IsIn([...QUALIFICATION_TYPES]) type?: (typeof QUALIFICATION_TYPES)[number];
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() institution?: string;
  @IsOptional() @IsString() graduatedAt?: string;
  @IsOptional() @IsString() certificateNumber?: string;
  @IsOptional() @IsString() documentId?: string;
}

export class UpdateQualificationDto {
  @IsOptional() @IsIn([...QUALIFICATION_TYPES]) type?: (typeof QUALIFICATION_TYPES)[number];
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() institution?: string;
  @IsOptional() @IsString() graduatedAt?: string;
  @IsOptional() @IsString() certificateNumber?: string;
  @IsOptional() @IsString() documentId?: string;
}

export class CreateCertificationDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() issuer?: string;
  @IsOptional() @IsString() issuedAt?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsIn([...CERTIFICATION_STATUSES]) status?: (typeof CERTIFICATION_STATUSES)[number];
}

export class UpdateCertificationDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() issuer?: string;
  @IsOptional() @IsString() issuedAt?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsIn([...CERTIFICATION_STATUSES]) status?: (typeof CERTIFICATION_STATUSES)[number];
}

export class CreateTrainingDto {
  @IsOptional() @IsString() code?: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsInt() @Min(0) cpdHours?: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
}

export class EnrollTrainingDto {
  @IsString() @IsNotEmpty() trainingId!: string;
  @IsString() @IsNotEmpty() employeeId!: string;
}

export class SetEnrollmentStatusDto {
  @IsIn([...ENROLLMENT_STATUSES]) status!: (typeof ENROLLMENT_STATUSES)[number];
  @IsOptional() @IsString() certificateUrl?: string;
}

// ── Skills, experience & documents (Phase 1) ────────────────────────────────

const PROFICIENCIES = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
const DOCUMENT_CATEGORIES = ['cv', 'id', 'contract', 'certificate', 'reference', 'medical', 'other'] as const;

export class CreateSkillDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSkillDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AddEmployeeSkillDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() skillId!: string;
  @IsOptional() @IsIn([...PROFICIENCIES]) proficiency?: (typeof PROFICIENCIES)[number];
  @IsOptional() @IsNumber() @Min(0) yearsExperience?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateEmployeeSkillDto {
  @IsOptional() @IsIn([...PROFICIENCIES]) proficiency?: (typeof PROFICIENCIES)[number];
  @IsOptional() @IsNumber() @Min(0) yearsExperience?: number;
  @IsOptional() @IsString() notes?: string;
}

/** Toggle admin verification on a skill or a document. */
export class VerifyDto {
  @IsBoolean() verified!: boolean;
}

export class AddExperienceDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsString() @IsNotEmpty() employer!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() referenceName?: string;
  @IsOptional() @IsString() referenceContact?: string;
  @IsOptional() @IsString() documentId?: string;
}

export class UpdateExperienceDto {
  @IsOptional() @IsString() @IsNotEmpty() employer?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() referenceName?: string;
  @IsOptional() @IsString() referenceContact?: string;
  @IsOptional() @IsString() documentId?: string;
}

/** Metadata accompanying a multipart document upload (strings from the form). */
export class UploadDocumentMetaDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsOptional() @IsIn([...DOCUMENT_CATEGORIES]) category?: (typeof DOCUMENT_CATEGORIES)[number];
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateDocumentDto {
  @IsOptional() @IsIn([...DOCUMENT_CATEGORIES]) category?: (typeof DOCUMENT_CATEGORIES)[number];
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() @IsNotEmpty() title?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── Reconciliation: HrEmployee ↔ StaffProfile bridge (Phase 2) ───────────────

export class LinkStaffDto {
  @IsString() @IsNotEmpty() staffProfileId!: string;
}

export class CreateEmployeeFromStaffDto {
  @IsString() @IsNotEmpty() staffProfileId!: string;
  @IsOptional() @IsString() employeeCode?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsIn([...EMPLOYMENT_TYPES]) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsNumber() @Min(0) baseSalary?: number;
  @IsOptional() @IsIn([...PAY_FREQUENCIES]) payFrequency?: (typeof PAY_FREQUENCIES)[number];
  @IsOptional() @IsString() notes?: string;
}

export class CreateStaffFromEmployeeDto {
  @IsString() @IsNotEmpty() employeeId!: string;
  @IsOptional() @IsString() employeeNo?: string;
  @IsOptional() @IsIn(['permanent', 'contract', 'temporary', 'probation']) contractType?: string;
  @IsOptional() @IsIn(['teaching', 'non_teaching', 'admin', 'support']) staffCategory?: string;
  @IsOptional() @IsString() campusId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() positionId?: string;
}
