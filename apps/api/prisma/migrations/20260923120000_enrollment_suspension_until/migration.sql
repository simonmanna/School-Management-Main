-- Suspension end date (audit F-21): a suspended learner is reinstated automatically
-- once suspendedUntil passes (StudentEnrollmentService.liftExpiredSuspensions).
ALTER TABLE "StudentEnrollment" ADD COLUMN IF NOT EXISTS "suspendedUntil" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "StudentEnrollment_status_suspendedUntil_idx" ON "StudentEnrollment"("status", "suspendedUntil");
