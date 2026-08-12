-- Phase F.7 — Trigram index for typo-tolerant search.
-- Requires the pg_trgm extension; created if missing (superuser on first
-- run). Subsequent runs are idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes on the most-searched columns. CONCURRENTLY is omitted so
-- the migration is safe in a single transaction; rebuild with
-- `CREATE INDEX CONCURRENTLY` once the table is large enough to matter.
CREATE INDEX IF NOT EXISTS "Partner_name_trgm_idx"           ON "Partner"         USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Partner_code_trgm_idx"           ON "Partner"         USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"           ON "Product"         USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_code_trgm_idx"           ON "Product"         USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx"            ON "Product"         USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Document_documentNumber_trgm_idx" ON "Document"        USING gin ("documentNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Document_reference_trgm_idx"      ON "Document"        USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Payment_paymentNumber_trgm_idx"    ON "Payment"         USING gin ("paymentNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Account_name_trgm_idx"            ON "Account"         USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Account_code_trgm_idx"            ON "Account"         USING gin (code gin_trgm_ops);
