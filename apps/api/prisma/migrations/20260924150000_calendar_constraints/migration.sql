-- Wave 4 · academic calendar invariants, enforced by the database.
-- Pre-check (2026-09-24, schooldb-planet): 0 orgs with two current years or
-- two current terms; 0 inverted date ranges; 26 terms outside their year
-- (25 integration-fixture rows + dev SUNRISE "Term 3").

-- Data fix: a term outside its year is repaired by widening the YEAR to cover
-- its terms, unless that would make the year overlap another year of the same
-- school (then the row is left and reported by the NOTICE below).
DO $$
DECLARE r record; fixed int := 0; left_alone int := 0;
BEGIN
  FOR r IN
    SELECT y.id, y."organizationId",
           LEAST(y."startDate", MIN(t."startDate")) AS new_start,
           GREATEST(y."endDate", MAX(t."endDate"))  AS new_end
      FROM "AcademicYear" y JOIN "Term" t ON t."academicYearId" = y.id
     GROUP BY y.id
    HAVING MIN(t."startDate") < y."startDate" OR MAX(t."endDate") > y."endDate"
  LOOP
    IF EXISTS (SELECT 1 FROM "AcademicYear" o
                WHERE o."organizationId" = r."organizationId" AND o.id <> r.id AND o."deletedAt" IS NULL
                  AND o."startDate" <= r.new_end AND o."endDate" >= r.new_start) THEN
      left_alone := left_alone + 1;
    ELSE
      UPDATE "AcademicYear" SET "startDate" = r.new_start, "endDate" = r.new_end WHERE id = r.id;
      fixed := fixed + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'term-within-year: widened % year(s); % left (would overlap another year)', fixed, left_alone;
END $$;

-- At most one current year and one current term per school.
CREATE UNIQUE INDEX IF NOT EXISTS "AcademicYear_one_current_per_org"
  ON "AcademicYear" ("organizationId") WHERE "isCurrent" AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Term_one_current_per_org"
  ON "Term" ("organizationId") WHERE "isCurrent";

-- Ordered date ranges.
ALTER TABLE "AcademicYear" DROP CONSTRAINT IF EXISTS "AcademicYear_dates_ordered";
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_dates_ordered" CHECK ("startDate" < "endDate");
ALTER TABLE "Term" DROP CONSTRAINT IF EXISTS "Term_dates_ordered";
ALTER TABLE "Term" ADD CONSTRAINT "Term_dates_ordered" CHECK ("startDate" < "endDate");

-- A term lies inside its year: checked when a term is written, and when a
-- year's dates move under its terms.
CREATE OR REPLACE FUNCTION enforce_term_within_year() RETURNS trigger AS $$
DECLARE ys timestamp; ye timestamp;
BEGIN
  IF TG_TABLE_NAME = 'Term' THEN
    SELECT "startDate", "endDate" INTO ys, ye FROM "AcademicYear" WHERE id = NEW."academicYearId";
    IF ys IS NOT NULL AND (NEW."startDate" < ys OR NEW."endDate" > ye) THEN
      RAISE EXCEPTION 'Term "%" (% – %) lies outside its academic year (% – %)',
        NEW.name, NEW."startDate"::date, NEW."endDate"::date, ys::date, ye::date
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Term" t WHERE t."academicYearId" = NEW.id
                AND (t."startDate" < NEW."startDate" OR t."endDate" > NEW."endDate")) THEN
      RAISE EXCEPTION 'Academic year "%" would no longer contain all of its terms', NEW.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS term_within_year ON "Term";
CREATE TRIGGER term_within_year BEFORE INSERT OR UPDATE OF "startDate", "endDate", "academicYearId" ON "Term"
  FOR EACH ROW EXECUTE FUNCTION enforce_term_within_year();
DROP TRIGGER IF EXISTS year_contains_terms ON "AcademicYear";
CREATE TRIGGER year_contains_terms BEFORE UPDATE OF "startDate", "endDate" ON "AcademicYear"
  FOR EACH ROW EXECUTE FUNCTION enforce_term_within_year();
