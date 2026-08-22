-- LMS mod_assign submissions (artefact only; marks stay in the assessment spine).
CREATE TABLE "ModAssignSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignId" TEXT NOT NULL,
    "courseModuleId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "content" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "feedback" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModAssignSubmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ModAssignSubmission_assignId_studentProfileId_attemptNo_key" ON "ModAssignSubmission"("assignId", "studentProfileId", "attemptNo");
CREATE INDEX "ModAssignSubmission_organizationId_courseModuleId_idx" ON "ModAssignSubmission"("organizationId", "courseModuleId");
CREATE INDEX "ModAssignSubmission_studentProfileId_idx" ON "ModAssignSubmission"("studentProfileId");
