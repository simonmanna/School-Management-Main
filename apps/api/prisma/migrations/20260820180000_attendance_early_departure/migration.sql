-- Add early-departure tracking to StudentAttendance.
-- The DTO + notifications subscriber already reference earlyDepartureMinutes,
-- but the column was never migrated. Nullable to preserve existing rows.

ALTER TABLE "StudentAttendance" ADD COLUMN "earlyDepartureMinutes" INTEGER;
