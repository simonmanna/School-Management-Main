-- PlacementMovementReason gains GRADUATION (ADR-030 companion, brief §13-14).
--
-- Nothing else in this file, on purpose: Postgres cannot use a new enum value in
-- the transaction that adds it, and Prisma wraps each migration file in one.
-- A terminal grade (P7) closes its placement with endReason = GRADUATION rather
-- than COMPLETION, so "left because they finished the ladder" is distinguishable
-- from an enrollment marked complete for any other reason.
ALTER TYPE "PlacementMovementReason" ADD VALUE IF NOT EXISTS 'GRADUATION';
