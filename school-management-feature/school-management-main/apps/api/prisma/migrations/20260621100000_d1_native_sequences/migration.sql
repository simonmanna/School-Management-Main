-- D1-1: Replace row-based Sequence with Postgres-native SEQUENCE objects.
--
-- Old design had a `Sequence` table with a `nextValue` column, written via
-- `Prisma upsert({ update: { nextValue: { increment: 1 } } })`. The upsert is
-- not atomic for the first-time-create case — two concurrent callers race on
-- INSERT, the loser throws `unique violation` and the request 500s.
--
-- New design: native Postgres `CREATE SEQUENCE … INCREMENT BY 1 START WITH 1`.
-- `nextval()` is a single atomic catalog operation with no row lock. Sequences
-- are namespaced per-organization (`seq_<orgShort>_<key>`) so a shared cluster
-- can host many tenants. The SequencesService creates them lazily on first use
-- and warms them up at boot.
--
-- One sequence per logical kind. The year (when relevant) is kept in the
-- formatted prefix string so legacy audit trails (e.g. `INV-2026-000001`) are
-- preserved; the sequence itself is monotonic across years.

-- Drop the row-based Sequence table (no data dependency — it was always empty
-- because the application generated numbers via the upsert on demand).
DROP TABLE IF EXISTS "Sequence";

-- Note: native sequences are created lazily by SequenceService.ensure() on
-- first use and warmed up at boot. We do NOT pre-create them here because
-- organizations are tenant-scoped (different sequence names per org).