-- ProgrammeStage gains PRE_PRIMARY and PRIMARY (ADR-028).
--
-- This file does NOTHING ELSE, on purpose.
--
-- Postgres cannot use a new enum value in the same transaction that adds it,
-- and Prisma wraps every migration file in one transaction. Putting the ADD
-- VALUE and its first use in one file produces:
--
--   ERROR: unsafe use of new value "PRE_PRIMARY" of enum type "ProgrammeStage"
--
-- ...halfway through, leaving the migration half-applied. The next migration
-- (20260920140100_academic_level) is the first that may reference these values.
--
-- IF NOT EXISTS keeps the file re-runnable.

ALTER TYPE "ProgrammeStage" ADD VALUE IF NOT EXISTS 'PRE_PRIMARY';
ALTER TYPE "ProgrammeStage" ADD VALUE IF NOT EXISTS 'PRIMARY';
