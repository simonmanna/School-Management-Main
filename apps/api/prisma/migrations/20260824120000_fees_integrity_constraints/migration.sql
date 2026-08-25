-- Fees integrity constraints (Phase 1b of the Fees production-hardening).
--
-- Closes P0-A, P0-B and P1-F, and lays the table P1-C needs. Every index here
-- exists because FINANCIAL_INVARIANTS §Concurrency requires DATABASE business-key
-- constraints — the application `findFirst` guards these replace all run under
-- READ COMMITTED, where two concurrent transactions both observe "not present"
-- and both insert.
--
-- GATE: apply only after `prisma/audit-fees-preconstraint.ts` exits 0.
--
-- ── AuditAction enum extension (P3) ────────────────────────────────────────
--
-- The reversal service (allocation-reversal.service.ts) audits `action:
-- 'reverse'` and `action: 'reallocate'`. These must exist in the database
-- enum, not just the @erp/shared TS union, or every reversal 500s on the
-- audit write. ADD VALUE cannot run inside Prisma's migration transaction
-- block, but `prisma db execute` of this file runs each statement in
-- autocommit, so it is safe here. IF NOT EXISTS guards re-application.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'reverse';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'reallocate';
--
-- CONCURRENTLY is deliberately NOT used: it cannot run inside a transaction
-- block, and Prisma wraps each migration in one. These tables are small enough
-- (fee documents and payments, not POS order lines) that a brief ACCESS
-- EXCLUSIVE lock at deploy time is the right trade for atomicity. If this ever
-- needs to run against a large live table, split it into a separate
-- non-transactional step rather than weakening the constraint.

-- ── P0-A · billing idempotency ─────────────────────────────────────────────
--
-- The business key is one charge per STUDENT per schedule per term. `partnerId`
-- is load-bearing: it mirrors the application guard at billing.service.ts:391,
-- and dropping it would express a completely different (and wrong) rule —
-- one invoice per schedule for the entire school. The Phase 0 audit confirmed
-- 20 legitimate student invoices on a single Term run would be rejected by the
-- narrower key.
--
-- Partial: only school charges, and only rows carrying the TERM-<termId>
-- reference that the billing run stamps.
CREATE UNIQUE INDEX "Document_org_partner_source_reference_key"
  ON "Document" ("organizationId", "partnerId", "sourceType", "sourceId", "reference")
  WHERE "sourceType" IN ('school_fee', 'school_penalty')
    AND "reference" IS NOT NULL;

-- ── P0-B · payment replay idempotency ──────────────────────────────────────
--
-- `reference` cannot be constrained: it is free text carrying both a provider's
-- transaction id and a bursar's narration, and a bursar may legitimately type
-- "CASH" on every receipt. Splitting the two meanings is the actual fix —
-- `externalReference` holds machine-issued keys only, and only it is unique.
ALTER TABLE "Payment"
  ADD COLUMN "externalReference"     TEXT,
  ADD COLUMN "externalReferenceType" TEXT;

COMMENT ON COLUMN "Payment"."externalReference" IS
  'Machine-issued idempotency key (MoMo/bank/card transaction id, import row ref). Unique per org+type+direction. Never bursar narration — that is "reference".';
COMMENT ON COLUMN "Payment"."externalReferenceType" IS
  'mobile_money_txn | bank_txn | card_txn | import_row';

CREATE UNIQUE INDEX "Payment_org_externalref_direction_key"
  ON "Payment" ("organizationId", "externalReferenceType", "externalReference", "direction")
  WHERE "externalReference" IS NOT NULL;

CREATE INDEX "Payment_org_externalref_idx"
  ON "Payment" ("organizationId", "externalReference")
  WHERE "externalReference" IS NOT NULL;

-- ── P1-F · one posted credit drawdown per (credit, document) ───────────────
CREATE UNIQUE INDEX "FeeCreditAllocation_credit_document_key"
  ON "FeeCreditAllocation" ("feeCreditId", "documentId")
  WHERE "status" = 'posted';

-- ── P1-C · allocation reversal as a NEW economic event ─────────────────────
--
-- Per FINANCIAL_INVARIANTS §Immutability, a posted PaymentAllocation is never
-- edited; reallocation is reverse-then-create. The reversal ROW is authoritative;
-- PaymentAllocation.status below is a cached projection of "does a reversal row
-- exist", exactly as FeeCredit.remaining projects FeeCreditAllocation.
CREATE TABLE "PaymentAllocationReversal" (
  "id"                  TEXT           NOT NULL,
  "organizationId"      TEXT           NOT NULL,
  "paymentAllocationId" TEXT           NOT NULL,
  "amount"              DECIMAL(20, 6) NOT NULL,
  "reason"              TEXT           NOT NULL,
  "journalEntryId"      TEXT,
  "reversedById"        TEXT,
  "approvedById"        TEXT,
  "reversedAt"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentAllocationReversal_pkey" PRIMARY KEY ("id")
);

-- One reversal per allocation: reversing twice would restore AR twice.
CREATE UNIQUE INDEX "PaymentAllocationReversal_allocation_key"
  ON "PaymentAllocationReversal" ("paymentAllocationId");
CREATE INDEX "PaymentAllocationReversal_organizationId_idx"
  ON "PaymentAllocationReversal" ("organizationId");

ALTER TABLE "PaymentAllocationReversal"
  ADD CONSTRAINT "PaymentAllocationReversal_paymentAllocationId_fkey"
  FOREIGN KEY ("paymentAllocationId") REFERENCES "PaymentAllocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cached projection only. 'posted' | 'reversed'.
ALTER TABLE "PaymentAllocation"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'posted';

COMMENT ON COLUMN "PaymentAllocation"."status" IS
  'Cached projection of PaymentAllocationReversal existence. posted | reversed. Never the authoritative record.';

CREATE INDEX "PaymentAllocation_org_status_idx"
  ON "PaymentAllocation" ("organizationId", "status");
