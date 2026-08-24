-- `Assessment.kind` becomes mandatory.
--
-- It landed nullable so the backfill could tell "not yet classified" apart from
-- "classified as cat" while readers still fell back to the legacy guess. Both
-- halves of that are now done: every producer sets `kind` at create (enforced by
-- a source scan in one-writer.spec.ts), and the backfill reports zero NULLs.
--
-- Making it NOT NULL is what retires the guess for good. While `kind` could be
-- null, a producer that forgot it silently weighted its marks against the CAT
-- component — which is a wrong term mark, not a missing label.
--
-- Safe to re-run: the UPDATE is a no-op once the backfill has run, and it is
-- here only so the migration cannot fail on a database that skipped it.
UPDATE "Assessment"
   SET kind = COALESCE(
         (SELECT c.kind FROM "AssessmentComponent" c WHERE c.id = "Assessment"."componentId"),
         (CASE "sourceType"::text
            WHEN 'exam_session' THEN 'exam'
            WHEN 'quiz'         THEN 'cat'
            WHEN 'lms_activity' THEN 'classwork'
            WHEN 'homework'     THEN 'homework'
            WHEN 'assignment'   THEN 'project'
            ELSE 'cat'
          END)::"AssessmentKind")
 WHERE kind IS NULL;

ALTER TABLE "Assessment" ALTER COLUMN "kind" SET NOT NULL;
