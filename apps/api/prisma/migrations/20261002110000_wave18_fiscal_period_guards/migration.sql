-- Wave 18: fiscal-period integrity.
--
-- 1. A period's end is the last instant of its last day. Periods stored with a
--    midnight end dropped every posting made later that day from the period
--    (and from the close totals); move those ends to 23:59:59.999.
UPDATE "FiscalPeriod"
   SET "endDate" = "endDate" + interval '1 day' - interval '1 millisecond'
 WHERE "endDate" = date_trunc('day', "endDate");

-- 2. A period ends after it starts.
ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_dates_ordered" CHECK ("endDate" > "startDate");

-- 3. Live periods of one organization never overlap, so exactly one period
--    governs a posting date (the guard used to pick an arbitrary one).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_no_overlap"
  EXCLUDE USING gist ("organizationId" WITH =, tsrange("startDate", "endDate", '[]') WITH &&)
  WHERE ("deletedAt" IS NULL);
