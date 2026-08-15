-- DropIndex
DROP INDEX "StudentAttendance_organizationId_studentProfileId_date_key";

-- AlterTable
ALTER TABLE "SchoolProfile" ADD COLUMN     "attendanceMode" TEXT NOT NULL DEFAULT 'daily';

-- AlterTable
ALTER TABLE "StudentAttendance" ADD COLUMN     "periodId" TEXT;

-- CreateIndex
CREATE INDEX "StudentAttendance_organizationId_studentProfileId_date_idx" ON "StudentAttendance"("organizationId", "studentProfileId", "date");

-- AddForeignKey
ALTER TABLE "StudentAttendance" ADD CONSTRAINT "StudentAttendance_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- P5: partial unique indexes so daily and period attendance both dedup correctly.
-- Prisma's @@unique on a nullable periodId would use NULLS DISTINCT, letting a
-- student accumulate many null-period daily rows for one date. Two partials fix
-- that: one for the daily register (periodId IS NULL) keyed by student+date, one
-- for period rows keyed by student+date+period.
CREATE UNIQUE INDEX "StudentAttendance_daily_unique"
  ON "StudentAttendance" ("organizationId", "studentProfileId", "date")
  WHERE "periodId" IS NULL;
CREATE UNIQUE INDEX "StudentAttendance_period_unique"
  ON "StudentAttendance" ("organizationId", "studentProfileId", "date", "periodId")
  WHERE "periodId" IS NOT NULL;
