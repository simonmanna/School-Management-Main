-- Live mobile-money collection (MTN MoMo / Airtel Money).
--
-- A request-to-pay is a PROMPT, not a receipt. Money becomes a Payment only
-- when the provider confirms, and then through SchoolPaymentService.collect
-- like every other tender — there is one payment writer and this is not it.
--
-- The unique index on providerRef is load-bearing twice over: it is how a
-- callback finds the request it belongs to, and it stops a duplicated request
-- from ever existing. Provider retries are made idempotent separately, by
-- Payment.externalReference (20260824120000).

CREATE TABLE "MobileMoneyRequest" (
  "id"               TEXT           NOT NULL,
  "organizationId"   TEXT           NOT NULL,
  "studentProfileId" TEXT           NOT NULL,
  -- mtn | airtel
  "provider"         TEXT           NOT NULL,
  "providerRef"      TEXT           NOT NULL,
  -- Normalised payer MSISDN (256XXXXXXXXX).
  "msisdn"           TEXT           NOT NULL,
  "amount"           DECIMAL(20, 6) NOT NULL,
  -- pending | succeeded | failed
  "status"           TEXT           NOT NULL DEFAULT 'pending',
  "note"             TEXT,
  "failureReason"    TEXT,
  "paymentId"        TEXT,
  "settledAt"        TIMESTAMP(3),
  "requestedById"    TEXT,
  "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)   NOT NULL,

  CONSTRAINT "MobileMoneyRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileMoneyRequest_providerRef_key"
  ON "MobileMoneyRequest" ("providerRef");
CREATE INDEX "MobileMoneyRequest_organizationId_idx"
  ON "MobileMoneyRequest" ("organizationId");
CREATE INDEX "MobileMoneyRequest_studentProfileId_idx"
  ON "MobileMoneyRequest" ("studentProfileId");
CREATE INDEX "MobileMoneyRequest_org_status_idx"
  ON "MobileMoneyRequest" ("organizationId", "status");

ALTER TABLE "MobileMoneyRequest"
  ADD CONSTRAINT "MobileMoneyRequest_studentProfileId_fkey"
  FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
