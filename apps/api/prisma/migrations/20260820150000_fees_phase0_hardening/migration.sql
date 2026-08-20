-- School Fees & Finance — Phase 0 ("stop the bleeding").
--
-- Companion to the P0 code fixes. Everything here is additive and safe to run
-- against live data: one defaulted column, CHECK constraints that encode states
-- that were already impossible in a correct system, and two unique indexes.

-- ── P0-3: separate forgiven money from received money ──────────────────────
-- Waivers and credit drawdowns were incrementing Document.amountPaid, making
-- forgiven balances indistinguishable from cash collected. Waivers now land
-- here instead.
ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "amountWaived" DECIMAL(20,6) NOT NULL DEFAULT 0;

-- ── Money sanity constraints ───────────────────────────────────────────────
-- Follows the CHECK-constraint convention already used by the assessment
-- module (Assessment_maxScore_check, AssessmentComponent_weight_check, ...).
-- These are the invariants the database itself can enforce; the rest live in
-- the service layer and the integrity test suite.
--
-- NOTE: deliberately NOT asserting amountPaid + amountResidual = totalAmount.
-- Historical rows corrupted by P0-2/P0-3 would violate it immediately, and the
-- correct repair path is the Phase 0.9 remediation batches, not a migration
-- that refuses to apply.
ALTER TABLE "Document"
  DROP CONSTRAINT IF EXISTS "Document_amountPaid_check",
  ADD CONSTRAINT "Document_amountPaid_check" CHECK ("amountPaid" >= 0);

ALTER TABLE "Document"
  DROP CONSTRAINT IF EXISTS "Document_amountResidual_check",
  ADD CONSTRAINT "Document_amountResidual_check" CHECK ("amountResidual" >= 0);

ALTER TABLE "Document"
  DROP CONSTRAINT IF EXISTS "Document_amountWaived_check",
  ADD CONSTRAINT "Document_amountWaived_check" CHECK ("amountWaived" >= 0);

ALTER TABLE "Waiver"
  DROP CONSTRAINT IF EXISTS "Waiver_amount_check",
  ADD CONSTRAINT "Waiver_amount_check" CHECK ("amount" > 0);

ALTER TABLE "FeeCredit"
  DROP CONSTRAINT IF EXISTS "FeeCredit_remaining_check",
  ADD CONSTRAINT "FeeCredit_remaining_check"
    CHECK ("remaining" >= 0 AND "remaining" <= "amount");

-- ── Business-key uniqueness ────────────────────────────────────────────────
-- Waiver.code and FeeCredit.code were free-form, so two waivers could carry the
-- same reference and no audit trail could distinguish them.
-- CONCURRENTLY is not used: Prisma migrations run inside a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "Waiver_organizationId_code_key"
  ON "Waiver" ("organizationId", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "FeeCredit_organizationId_code_key"
  ON "FeeCredit" ("organizationId", "code");
