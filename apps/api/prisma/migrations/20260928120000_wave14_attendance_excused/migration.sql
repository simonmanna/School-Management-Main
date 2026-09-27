-- Wave 14 (audit 2026-09-27 F08): excused absence is its own bucket so the
-- school's ADR-032 P1 denominator choice can apply. Existing 'excused' codes
-- (seeded with isAbsent) are marked.
ALTER TABLE "AttendanceStatusConfig" ADD COLUMN "isExcused" BOOLEAN NOT NULL DEFAULT false;
UPDATE "AttendanceStatusConfig" SET "isExcused" = true WHERE "code" = 'excused';
