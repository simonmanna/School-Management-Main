-- Add the canonical CourseOffering spine link to TimetableSlot.
-- Nullable so existing rows are preserved; backfilled lazily by TimetableService.

ALTER TABLE "TimetableSlot" ADD COLUMN "courseOfferingId" TEXT;

ALTER TABLE "TimetableSlot"
  ADD CONSTRAINT "TimetableSlot_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TimetableSlot_courseOfferingId_idx" ON "TimetableSlot"("courseOfferingId");
