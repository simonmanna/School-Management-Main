CREATE TABLE "HrJobGrade" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSalary" DECIMAL(20,6),
    "midSalary" DECIMAL(20,6),
    "maxSalary" DECIMAL(20,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrJobGrade_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrSalaryStructure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "amount" DECIMAL(20,6),
    "rate" DECIMAL(10,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrSalaryStructure_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrSalaryChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "previousAmount" DECIMAL(20,6),
    "newAmount" DECIMAL(20,6),
    "reason" TEXT,
    "changedById" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "HrSalaryChange_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrEmploymentAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "HrEmploymentAction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'permanent',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "payFrequency" TEXT,
    "salary" JSONB,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrContract_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrOnboardingTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrOnboardingTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrOffboarding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "noticeDate" TIMESTAMP(3),
    "lastWorkingDay" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "salaryDue" DECIMAL(20,6),
    "leavePayout" DECIMAL(20,6),
    "loanOutstanding" DECIMAL(20,6),
    "advanceOutstanding" DECIMAL(20,6),
    "otherDeductions" DECIMAL(20,6),
    "netSettlement" DECIMAL(20,6),
    "journalEntryId" TEXT,
    "notes" TEXT,
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrOffboarding_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrVacancy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "positionId" TEXT,
    "departmentId" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "salaryRange" JSONB,
    "hiringManagerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "approvedById" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrVacancy_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrApplicant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "cvUrl" TEXT,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "score" INTEGER,
    "notes" TEXT,
    "hiredEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrApplicant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrInterview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "interviewerId" TEXT,
    "score" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrInterview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrQualification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'degree',
    "title" TEXT NOT NULL,
    "institution" TEXT,
    "graduatedAt" TIMESTAMP(3),
    "certificateNumber" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrQualification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrCertification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrCertification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrTraining" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT,
    "cost" DECIMAL(20,6),
    "cpdHours" INTEGER,
    "category" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTraining_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrTrainingEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "certificateUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'enrolled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrTrainingEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrStatutoryConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configType" TEXT NOT NULL DEFAULT 'PENSION',
    "rate" DECIMAL(10,6),
    "employerRate" DECIMAL(10,6),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HrStatutoryConfig_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "HrEmployeeAuditTrail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "approverId" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeAuditTrail_pkey" PRIMARY KEY ("id")
);
