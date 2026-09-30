-- Wave 18: an external reference is an idempotency key only if the database
-- enforces it. Postgres treats NULLs as distinct, so a key sent without a type
-- (externalReferenceType NULL) was never deduplicated by either unique index.
-- Rebuild the hand-written partial index with NULLS NOT DISTINCT (PostgreSQL
-- 15+) so an untyped key is unique too; the Prisma-managed full index is left
-- as it is. The API now also requires a type whenever a reference is given.
DROP INDEX IF EXISTS "Payment_org_externalref_direction_key";
CREATE UNIQUE INDEX "Payment_org_externalref_direction_key"
  ON "Payment" ("organizationId", "externalReferenceType", "externalReference", "direction")
  NULLS NOT DISTINCT
  WHERE "externalReference" IS NOT NULL;
