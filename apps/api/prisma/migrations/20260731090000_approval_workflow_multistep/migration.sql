-- DropIndex
DROP INDEX "ApprovalDecision_requestId_approverId_key";

-- AlterTable
ALTER TABLE "ApprovalDecision" ADD COLUMN     "stepOrder" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "workflowId" TEXT;

-- CreateTable
CREATE TABLE "ApprovalWorkflow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "minAmount" DECIMAL(20,6),
    "enforceDistinctApprovers" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "approverPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "minAmount" DECIMAL(20,6),
    "maxAmount" DECIMAL(20,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalWorkflow_organizationId_entityType_isActive_idx" ON "ApprovalWorkflow"("organizationId", "entityType", "isActive");

-- CreateIndex
CREATE INDEX "ApprovalStep_organizationId_workflowId_idx" ON "ApprovalStep"("organizationId", "workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_workflowId_stepOrder_key" ON "ApprovalStep"("workflowId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_stepOrder_approverId_key" ON "ApprovalDecision"("requestId", "stepOrder", "approverId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

