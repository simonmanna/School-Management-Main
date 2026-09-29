-- Wave 16: alert guardians on the Nth absent school day in a row. Null = off.
ALTER TABLE "AttendanceThreshold" ADD COLUMN "consecutiveAbsenceAlert" INTEGER;
