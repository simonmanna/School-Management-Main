-- CreateEnum
CREATE TYPE "HrEmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CASUAL', 'PROBATION');

-- CreateEnum
CREATE TYPE "HrPayFrequency" AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "HrAttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "HrAttendanceMethod" AS ENUM ('PIN', 'RFID', 'QR', 'FACE', 'FINGERPRINT', 'MANUAL', 'APP');

-- CreateEnum
CREATE TYPE "HrAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EARLY_LEAVE', 'ON_LEAVE', 'OFF_DAY');

-- CreateEnum
CREATE TYPE "HrShiftType" AS ENUM ('MORNING', 'AFTERNOON', 'NIGHT', 'SPLIT', 'ROTATING', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "HrTimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HrTimesheetWorkType" AS ENUM ('REPAIR', 'HOTEL', 'SCHOOL', 'RENTAL', 'CLEANING', 'MANUFACTURING', 'PROJECT', 'CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "HrLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrPayrollComponentType" AS ENUM ('ALLOWANCE', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "HrPayrollCalcMethod" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "HrTaxType" AS ENUM ('PAYE', 'PENSION', 'SOCIAL_SECURITY', 'LOCAL');

-- CreateEnum
CREATE TYPE "HrPayrollPeriodType" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "HrPayrollPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "HrPayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'REVERSED', 'PAID');

-- CreateEnum
CREATE TYPE "HrPayslipStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID');

-- CreateEnum
CREATE TYPE "HrAdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'SETTLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HrLoanStatus" AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "HrPaymentMethod" AS ENUM ('BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "HrBankPaymentStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'PAID');

-- CreateEnum
CREATE TYPE "HrReviewStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateTable
CREATE TABLE "HrDepartment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "managerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "defaultSalary" DECIMAL(20,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "photoUrl" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "employmentType" "HrEmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    "hireDate" TIMESTAMP(3),
    "contractEndDate" TIMESTAMP(3),
    "probationEndDate" TIMESTAMP(3),
    "departmentId" TEXT,
    "positionId" TEXT,
    "supervisorId" TEXT,
    "baseSalary" DECIMAL(20,6),
    "payFrequency" "HrPayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "hourlyRate" DECIMAL(20,6),
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "mobileMoneyProvider" TEXT,
    "mobileMoneyNumber" TEXT,
    "taxNumber" TEXT,
    "pensionNumber" TEXT,
    "socialSecurityNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shiftType" "HrShiftType" NOT NULL DEFAULT 'MORNING',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakStart" TEXT,
    "breakEnd" TEXT,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxOvertimeMinutes" INTEGER DEFAULT 180,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrShiftAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "shiftId" TEXT,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "breakStartAt" TIMESTAMP(3),
    "breakEndAt" TIMESTAMP(3),
    "totalBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "HrAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "HrAttendanceMethod" NOT NULL DEFAULT 'MANUAL',
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendanceLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "employeeId" TEXT NOT NULL,
    "eventType" "HrAttendanceEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "HrAttendanceMethod" NOT NULL DEFAULT 'MANUAL',
    "deviceId" TEXT,
    "ipAddress" TEXT,
    "gpsLat" DECIMAL(10,7),
    "gpsLng" DECIMAL(10,7),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "HrAttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTimesheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timesheetCode" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "HrTimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTimesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTimesheetEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "workType" "HrTimesheetWorkType" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "daysPerYear" INTEGER NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "carryForwardDays" INTEGER NOT NULL DEFAULT 0,
    "maxConsecutiveDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrLeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "accruedDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "usedDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "adjustedDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrLeaveRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(10,2) NOT NULL,
    "status" "HrLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "componentType" "HrPayrollComponentType" NOT NULL,
    "calcMethod" "HrPayrollCalcMethod" NOT NULL DEFAULT 'FIXED',
    "amount" DECIMAL(20,6),
    "rate" DECIMAL(10,6),
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTaxTable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT,
    "taxType" "HrTaxType" NOT NULL DEFAULT 'PAYE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTaxTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTaxBracket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxTableId" TEXT NOT NULL,
    "fromAmount" DECIMAL(20,6) NOT NULL,
    "toAmount" DECIMAL(20,6),
    "rate" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodCode" TEXT NOT NULL,
    "periodType" "HrPayrollPeriodType" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "HrPayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" "HrPayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentDate" TIMESTAMP(3),
    "totalGross" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "glPosted" BOOLEAN NOT NULL DEFAULT false,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseSalary" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "regularHours" INTEGER NOT NULL DEFAULT 0,
    "overtimeHours" INTEGER NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "allowancesTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "bonusAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "pensionAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "socialSecurityAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "loanDeduction" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "advanceDeduction" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "insuranceAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "absenceDays" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollAllowance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayrollDeduction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayrollDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPayslip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payslipNumber" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" "HrPayslipStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "paymentMethod" "HrPaymentMethod",
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPayslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSalaryAdvance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "advanceCode" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "installmentMonths" INTEGER NOT NULL DEFAULT 3,
    "monthlyDeduction" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "HrAdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrSalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeLoan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "loanCode" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "principal" DECIMAL(20,6) NOT NULL,
    "interestRate" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "installmentAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "installmentsTotal" INTEGER NOT NULL DEFAULT 1,
    "installmentsPaid" INTEGER NOT NULL DEFAULT 0,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "HrLoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "disbursedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrEmployeeLoan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrBankPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentCode" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "HrPaymentMethod" NOT NULL DEFAULT 'BANK',
    "status" "HrBankPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "processedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrBankPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrBankPaymentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankPaymentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "mobileMoneyProvider" TEXT,
    "mobileMoneyNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrBankPaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrPerformanceReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "attendanceRate" DECIMAL(5,2),
    "lateRate" DECIMAL(5,2),
    "absenteeismDays" DECIMAL(10,2),
    "jobsCompleted" INTEGER,
    "billableHours" DECIMAL(10,2),
    "overtimeHours" DECIMAL(10,2),
    "kpiScore" DECIMAL(5,2),
    "rating" INTEGER,
    "notes" TEXT,
    "status" "HrReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrPerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrDepartment_organizationId_deletedAt_idx" ON "HrDepartment"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrDepartment_organizationId_code_key" ON "HrDepartment"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrPosition_organizationId_deletedAt_idx" ON "HrPosition"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPosition_organizationId_code_key" ON "HrPosition"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployee_userId_key" ON "HrEmployee"("userId");

-- CreateIndex
CREATE INDEX "HrEmployee_organizationId_deletedAt_idx" ON "HrEmployee"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrEmployee_organizationId_departmentId_idx" ON "HrEmployee"("organizationId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployee_organizationId_employeeCode_key" ON "HrEmployee"("organizationId", "employeeCode");

-- CreateIndex
CREATE INDEX "HrShift_organizationId_deletedAt_idx" ON "HrShift"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrShift_organizationId_code_key" ON "HrShift"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrShiftAssignment_organizationId_employeeId_deletedAt_idx" ON "HrShiftAssignment"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrAttendance_organizationId_date_deletedAt_idx" ON "HrAttendance"("organizationId", "date", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendance_organizationId_employeeId_date_key" ON "HrAttendance"("organizationId", "employeeId", "date");

-- CreateIndex
CREATE INDEX "HrAttendanceLog_organizationId_employeeId_timestamp_idx" ON "HrAttendanceLog"("organizationId", "employeeId", "timestamp");

-- CreateIndex
CREATE INDEX "HrTimesheet_organizationId_employeeId_deletedAt_idx" ON "HrTimesheet"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrTimesheet_organizationId_timesheetCode_key" ON "HrTimesheet"("organizationId", "timesheetCode");

-- CreateIndex
CREATE INDEX "HrTimesheetEntry_organizationId_timesheetId_deletedAt_idx" ON "HrTimesheetEntry"("organizationId", "timesheetId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrTimesheetEntry_organizationId_linkedEntityType_linkedEnti_idx" ON "HrTimesheetEntry"("organizationId", "linkedEntityType", "linkedEntityId");

-- CreateIndex
CREATE INDEX "HrLeaveType_organizationId_deletedAt_idx" ON "HrLeaveType"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveType_organizationId_code_key" ON "HrLeaveType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrLeaveBalance_organizationId_deletedAt_idx" ON "HrLeaveBalance"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveBalance_organizationId_employeeId_leaveTypeId_year_key" ON "HrLeaveBalance"("organizationId", "employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_organizationId_employeeId_deletedAt_idx" ON "HrLeaveRequest"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrLeaveRequest_organizationId_status_deletedAt_idx" ON "HrLeaveRequest"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveRequest_organizationId_requestCode_key" ON "HrLeaveRequest"("organizationId", "requestCode");

-- CreateIndex
CREATE INDEX "HrHoliday_organizationId_date_idx" ON "HrHoliday"("organizationId", "date");

-- CreateIndex
CREATE INDEX "HrHoliday_organizationId_deletedAt_idx" ON "HrHoliday"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrPayrollComponent_organizationId_deletedAt_idx" ON "HrPayrollComponent"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollComponent_organizationId_code_key" ON "HrPayrollComponent"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrTaxTable_organizationId_deletedAt_idx" ON "HrTaxTable"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrTaxTable_organizationId_code_key" ON "HrTaxTable"("organizationId", "code");

-- CreateIndex
CREATE INDEX "HrTaxBracket_organizationId_taxTableId_idx" ON "HrTaxBracket"("organizationId", "taxTableId");

-- CreateIndex
CREATE INDEX "HrPayrollPeriod_organizationId_deletedAt_idx" ON "HrPayrollPeriod"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollPeriod_organizationId_periodCode_key" ON "HrPayrollPeriod"("organizationId", "periodCode");

-- CreateIndex
CREATE INDEX "HrPayrollRun_organizationId_periodId_deletedAt_idx" ON "HrPayrollRun"("organizationId", "periodId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollRun_organizationId_runNumber_key" ON "HrPayrollRun"("organizationId", "runNumber");

-- CreateIndex
CREATE INDEX "HrPayrollItem_organizationId_runId_deletedAt_idx" ON "HrPayrollItem"("organizationId", "runId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayrollItem_organizationId_runId_employeeId_key" ON "HrPayrollItem"("organizationId", "runId", "employeeId");

-- CreateIndex
CREATE INDEX "HrPayrollAllowance_organizationId_itemId_idx" ON "HrPayrollAllowance"("organizationId", "itemId");

-- CreateIndex
CREATE INDEX "HrPayrollDeduction_organizationId_itemId_idx" ON "HrPayrollDeduction"("organizationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayslip_itemId_key" ON "HrPayslip"("itemId");

-- CreateIndex
CREATE INDEX "HrPayslip_organizationId_deletedAt_idx" ON "HrPayslip"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrPayslip_organizationId_payslipNumber_key" ON "HrPayslip"("organizationId", "payslipNumber");

-- CreateIndex
CREATE INDEX "HrSalaryAdvance_organizationId_employeeId_deletedAt_idx" ON "HrSalaryAdvance"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrSalaryAdvance_organizationId_status_deletedAt_idx" ON "HrSalaryAdvance"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrSalaryAdvance_organizationId_advanceCode_key" ON "HrSalaryAdvance"("organizationId", "advanceCode");

-- CreateIndex
CREATE INDEX "HrEmployeeLoan_organizationId_employeeId_deletedAt_idx" ON "HrEmployeeLoan"("organizationId", "employeeId", "deletedAt");

-- CreateIndex
CREATE INDEX "HrEmployeeLoan_organizationId_status_deletedAt_idx" ON "HrEmployeeLoan"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeLoan_organizationId_loanCode_key" ON "HrEmployeeLoan"("organizationId", "loanCode");

-- CreateIndex
CREATE INDEX "HrBankPayment_organizationId_runId_deletedAt_idx" ON "HrBankPayment"("organizationId", "runId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HrBankPayment_organizationId_paymentCode_key" ON "HrBankPayment"("organizationId", "paymentCode");

-- CreateIndex
CREATE INDEX "HrBankPaymentLine_organizationId_bankPaymentId_idx" ON "HrBankPaymentLine"("organizationId", "bankPaymentId");

-- CreateIndex
CREATE INDEX "HrPerformanceReview_organizationId_employeeId_deletedAt_idx" ON "HrPerformanceReview"("organizationId", "employeeId", "deletedAt");

-- AddForeignKey
ALTER TABLE "HrDepartment" ADD CONSTRAINT "HrDepartment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "HrEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPosition" ADD CONSTRAINT "HrPosition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "HrPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployee" ADD CONSTRAINT "HrEmployee_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "HrEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrShiftAssignment" ADD CONSTRAINT "HrShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendance" ADD CONSTRAINT "HrAttendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendance" ADD CONSTRAINT "HrAttendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceLog" ADD CONSTRAINT "HrAttendanceLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "HrAttendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceLog" ADD CONSTRAINT "HrAttendanceLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTimesheet" ADD CONSTRAINT "HrTimesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTimesheetEntry" ADD CONSTRAINT "HrTimesheetEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "HrTimesheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "HrLeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "HrLeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTaxBracket" ADD CONSTRAINT "HrTaxBracket_taxTableId_fkey" FOREIGN KEY ("taxTableId") REFERENCES "HrTaxTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayrollRun" ADD CONSTRAINT "HrPayrollRun_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "HrPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayrollItem" ADD CONSTRAINT "HrPayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HrPayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayrollItem" ADD CONSTRAINT "HrPayrollItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayrollAllowance" ADD CONSTRAINT "HrPayrollAllowance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HrPayrollItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayrollDeduction" ADD CONSTRAINT "HrPayrollDeduction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HrPayrollItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPayslip" ADD CONSTRAINT "HrPayslip_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HrPayrollItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSalaryAdvance" ADD CONSTRAINT "HrSalaryAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeLoan" ADD CONSTRAINT "HrEmployeeLoan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrBankPayment" ADD CONSTRAINT "HrBankPayment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HrPayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrBankPaymentLine" ADD CONSTRAINT "HrBankPaymentLine_bankPaymentId_fkey" FOREIGN KEY ("bankPaymentId") REFERENCES "HrBankPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrBankPaymentLine" ADD CONSTRAINT "HrBankPaymentLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrPerformanceReview" ADD CONSTRAINT "HrPerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

