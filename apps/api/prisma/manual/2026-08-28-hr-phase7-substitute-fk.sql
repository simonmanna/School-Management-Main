-- HR Phase 7: give TimetableSlot.substituteTeacherId a real FK + index.
--
-- It was a bare String: no FK (so it could name a deleted or nonexistent
-- teacher), no index (so "what am I covering?" was a table scan), and it was
-- excluded from detectConflicts() entirely — cover could be double-booked.

-- Null out any value that does not resolve, so the FK can be added safely.
UPDATE "TimetableSlot" ts
SET "substituteTeacherId" = NULL
WHERE ts."substituteTeacherId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "StaffProfile" sp WHERE sp."id" = ts."substituteTeacherId");

CREATE INDEX IF NOT EXISTS "TimetableSlot_substituteTeacherId_dayOfWeek_idx"
  ON "TimetableSlot"("substituteTeacherId", "dayOfWeek");

DO $$ BEGIN
  ALTER TABLE "TimetableSlot"
    ADD CONSTRAINT "TimetableSlot_substituteTeacherId_fkey"
    FOREIGN KEY ("substituteTeacherId") REFERENCES "StaffProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
