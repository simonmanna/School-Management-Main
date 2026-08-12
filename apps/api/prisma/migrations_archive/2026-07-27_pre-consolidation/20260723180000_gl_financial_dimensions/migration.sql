-- Phase 3 (accounting hardening) — extensible financial dimensions.
-- A generic, per-posting segmentation bag (cashierId, cashSessionId, registerId,
-- campus, term, department, project, ...) without a column per dimension.
-- Branch / cost-center remain typed columns; this JSON carries the rest.

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "dimensions" JSONB;
ALTER TABLE "JournalLine" ADD COLUMN "dimensions" JSONB;
