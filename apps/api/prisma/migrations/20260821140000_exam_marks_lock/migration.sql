-- Marks lock: an admin freezes mark entry for one exam paper (exam × class ×
-- subject) without conflating it with the academic approval workflow, which is
-- segregation-of-duty guarded and cannot be self-served by a one-person office.
ALTER TABLE "ExamSchedule" ADD COLUMN IF NOT EXISTS "marksLockedAt" TIMESTAMP(3);
ALTER TABLE "ExamSchedule" ADD COLUMN IF NOT EXISTS "marksLockedById" TEXT;
