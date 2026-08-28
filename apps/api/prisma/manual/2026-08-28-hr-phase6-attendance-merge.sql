-- HR Phase 6: fold the school's `StaffAttendance` into the canonical
-- `HrAttendance`.
--
-- Both tables sit at the same grain — one row per (org, person, date) — but
-- only `HrAttendance` is read by payroll, and only it carries shift, worked /
-- overtime / late minutes and the event log. A school marking attendance in the
-- other table produced numbers the pay run ignored.
--
-- Copies only rows whose staff member is bridged to an `HrEmployee` (Phase 2).
-- Unbridged rows stay put; the reconciliation screen is how they get bridged,
-- and re-running this migration picks them up. Existing HR rows always win —
-- they are the richer record.

INSERT INTO "HrAttendance" (
  "id", "organizationId", "employeeId", "date",
  "checkInAt", "checkOutAt", "status", "source", "notes",
  "createdAt", "updatedAt", "createdBy"
)
SELECT
  gen_random_uuid()::text,
  sa."organizationId",
  e."id",
  sa."date",
  sa."checkIn",
  sa."checkOut",
  CASE sa."status"
    WHEN 'present'  THEN 'PRESENT'
    WHEN 'absent'   THEN 'ABSENT'
    WHEN 'late'     THEN 'LATE'
    WHEN 'leave'    THEN 'ON_LEAVE'
    WHEN 'off_duty' THEN 'OFF_DAY'
    ELSE 'PRESENT'
  END::"HrAttendanceStatus",
  'MANUAL'::"HrAttendanceMethod",
  sa."notes",
  sa."createdAt",
  CURRENT_TIMESTAMP,
  sa."markedById"
FROM "StaffAttendance" sa
JOIN "StaffProfile" sp
  ON sp."id" = sa."staffProfileId"
 AND sp."deletedAt" IS NULL
JOIN "HrEmployee" e
  ON e."partnerId" = sp."partnerId"
 AND e."organizationId" = sa."organizationId"
 AND e."deletedAt" IS NULL
-- Never clobber an existing canonical row.
WHERE NOT EXISTS (
  SELECT 1 FROM "HrAttendance" ha
  WHERE ha."organizationId" = sa."organizationId"
    AND ha."employeeId" = e."id"
    AND ha."date" = sa."date"
);

-- Drop the legacy rows that were successfully copied, so the two stores cannot
-- drift. Anything left behind belongs to an unbridged staff member.
DELETE FROM "StaffAttendance" sa
USING "StaffProfile" sp, "HrEmployee" e, "HrAttendance" ha
WHERE sp."id" = sa."staffProfileId"
  AND e."partnerId" = sp."partnerId"
  AND e."organizationId" = sa."organizationId"
  AND ha."organizationId" = sa."organizationId"
  AND ha."employeeId" = e."id"
  AND ha."date" = sa."date";
