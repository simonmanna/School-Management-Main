-- B6: seal GradeEntry read-only. It is now frozen historic evidence; the
-- Assessment → StudentAssessment → MarkEntry spine is the only mark store.
-- Blocks INSERT/UPDATE/DELETE. Rollback: DROP TRIGGER + DROP FUNCTION.
CREATE OR REPLACE FUNCTION gradeentry_unwritable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GradeEntry is read-only (B6): % is not permitted; marks live on the assessment spine', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gradeentry_no_write ON "GradeEntry";
CREATE TRIGGER gradeentry_no_write
  BEFORE INSERT OR UPDATE OR DELETE ON "GradeEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION gradeentry_unwritable();
