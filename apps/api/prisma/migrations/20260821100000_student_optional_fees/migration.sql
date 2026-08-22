-- P3: per-student opt-in for OPTIONAL fee categories.
-- Mandatory categories bill the whole structure scope; an optional category
-- only reaches a student's invoice when a row exists here.

-- CreateTable
CREATE TABLE "StudentOptionalFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "feeCategoryId" TEXT NOT NULL,
    "amount" DECIMAL(20,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentOptionalFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentOptionalFee_organizationId_idx" ON "StudentOptionalFee"("organizationId");

-- CreateIndex
CREATE INDEX "StudentOptionalFee_termId_feeCategoryId_idx" ON "StudentOptionalFee"("termId", "feeCategoryId");

-- CreateIndex
CREATE INDEX "StudentOptionalFee_studentProfileId_idx" ON "StudentOptionalFee"("studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentOptionalFee_organizationId_studentProfileId_termId_fe_key"
    ON "StudentOptionalFee"("organizationId", "studentProfileId", "termId", "feeCategoryId");

-- AddForeignKey
ALTER TABLE "StudentOptionalFee" ADD CONSTRAINT "StudentOptionalFee_studentProfileId_fkey"
    FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentOptionalFee" ADD CONSTRAINT "StudentOptionalFee_termId_fkey"
    FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentOptionalFee" ADD CONSTRAINT "StudentOptionalFee_feeCategoryId_fkey"
    FOREIGN KEY ("feeCategoryId") REFERENCES "FeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
