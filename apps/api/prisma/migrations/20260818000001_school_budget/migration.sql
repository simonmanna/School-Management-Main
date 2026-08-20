-- Create school finance Budget table
CREATE TABLE "Budget" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "academicYearId" TEXT,
  "termId" TEXT,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "currency" TEXT,
  "periodFrom" TIMESTAMP(3),
  "periodTo" TIMESTAMP(3),
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Budget_organizationId_idx" ON "Budget" ("organizationId");
CREATE INDEX "Budget_academicYearId_idx" ON "Budget" ("academicYearId");
CREATE INDEX "Budget_termId_idx" ON "Budget" ("termId");

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
