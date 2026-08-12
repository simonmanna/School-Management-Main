-- Phase F.6: Procurement chain (PR → RFQ → PO → GRN → Bill), three-way match,
-- debit notes, push notification subscriptions, append-only domain event log.

-- ===== Procurement enums =====
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('draft','submitted','approved','rejected','cancelled','converted');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft','submitted','approved','sent','acknowledged','partially_received','received','billed','closed','cancelled');
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('draft','posted','cancelled');
CREATE TYPE "MatchStatus" AS ENUM ('pending','matched','partial','mismatch','blocked');
CREATE TYPE "DebitNoteReason" AS ENUM ('price_adjustment','returned_goods','overcharge','correction','other');

-- ===== Purchase requests =====
CREATE TABLE "PurchaseRequest" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "requestNumber"  TEXT NOT NULL,
  "requestedById"  TEXT,
  "partnerId"      TEXT,
  "branchId"       TEXT,
  "description"    TEXT,
  "neededBy"       TIMESTAMP(3),
  "status"         "PurchaseRequestStatus" NOT NULL DEFAULT 'draft',
  "approvedAt"     TIMESTAMP(3),
  "approvedById"   TEXT,
  "rejectedReason" TEXT,
  "snapshot"       JSONB,
  "customFields"   JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3),
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  UNIQUE ("organizationId","requestNumber")
);
CREATE INDEX "PurchaseRequest_organizationId_status_idx" ON "PurchaseRequest"("organizationId","status");
CREATE INDEX "PurchaseRequest_organizationId_neededBy_idx" ON "PurchaseRequest"("organizationId","neededBy");
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;

CREATE TABLE "PurchaseRequestLine" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "purchaseRequestId" TEXT NOT NULL,
  "productId"         TEXT,
  "description"       TEXT NOT NULL,
  "quantity"          DECIMAL(20,6) NOT NULL,
  "unitOfMeasureId"   TEXT,
  "estimatedUnitPrice" DECIMAL(20,6),
  "notes"             TEXT,
  "lineNumber"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE
);
CREATE INDEX "PurchaseRequestLine_organizationId_purchaseRequestId_idx" ON "PurchaseRequestLine"("organizationId","purchaseRequestId");

-- ===== Purchase orders =====
CREATE TABLE "PurchaseOrder" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "orderNumber"         TEXT NOT NULL,
  "partnerId"           TEXT NOT NULL,
  "branchId"            TEXT,
  "description"         TEXT,
  "orderDate"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedDeliveryDate" TIMESTAMP(3),
  "currencyCode"        TEXT NOT NULL DEFAULT 'USD',
  "exchangeRate"        DECIMAL(18,8) NOT NULL DEFAULT 1,
  "subtotal"            DECIMAL(20,6) NOT NULL DEFAULT 0,
  "taxAmount"           DECIMAL(20,6) NOT NULL DEFAULT 0,
  "totalAmount"         DECIMAL(20,6) NOT NULL DEFAULT 0,
  "status"              "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
  "approvedAt"          TIMESTAMP(3),
  "approvedById"        TEXT,
  "sentAt"              TIMESTAMP(3),
  "notes"               TEXT,
  "terms"               TEXT,
  "snapshot"            JSONB,
  "customFields"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"           TIMESTAMP(3),
  "requestId"           TEXT,
  "parentOrderId"       TEXT,
  "createdBy"           TEXT,
  "updatedBy"           TEXT,
  UNIQUE ("organizationId","orderNumber"),
  CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL
);
CREATE INDEX "PurchaseOrder_organizationId_partnerId_idx" ON "PurchaseOrder"("organizationId","partnerId");
CREATE INDEX "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId","status");
CREATE INDEX "PurchaseOrder_organizationId_orderDate_idx" ON "PurchaseOrder"("organizationId","orderDate");

CREATE TABLE "PurchaseOrderLine" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "purchaseOrderId"   TEXT NOT NULL,
  "productId"         TEXT,
  "description"       TEXT NOT NULL,
  "quantity"          DECIMAL(20,6) NOT NULL,
  "receivedQuantity"  DECIMAL(20,6) NOT NULL DEFAULT 0,
  "billedQuantity"    DECIMAL(20,6) NOT NULL DEFAULT 0,
  "unitOfMeasureId"   TEXT,
  "unitPrice"         DECIMAL(20,6) NOT NULL,
  "taxRate"           DECIMAL(9,6) NOT NULL DEFAULT 0,
  "taxId"             TEXT,
  "subtotal"          DECIMAL(20,6) NOT NULL DEFAULT 0,
  "lineNumber"        INTEGER NOT NULL DEFAULT 0,
  "notes"             TEXT,
  CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE
);
CREATE INDEX "PurchaseOrderLine_organizationId_purchaseOrderId_idx" ON "PurchaseOrderLine"("organizationId","purchaseOrderId");

-- ===== Goods receipts =====
CREATE TABLE "GoodsReceiptNote" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "receiptNumber"   TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "partnerId"       TEXT,
  "branchId"        TEXT,
  "warehouseId"     TEXT,
  "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"          "GoodsReceiptStatus" NOT NULL DEFAULT 'draft',
  "notes"           TEXT,
  "postedAt"        TIMESTAMP(3),
  "postedById"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),
  "createdBy"       TEXT,
  "updatedBy"       TEXT,
  UNIQUE ("organizationId","receiptNumber"),
  CONSTRAINT "GoodsReceiptNote_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL
);
CREATE INDEX "GoodsReceiptNote_organizationId_purchaseOrderId_idx" ON "GoodsReceiptNote"("organizationId","purchaseOrderId");
CREATE INDEX "GoodsReceiptNote_organizationId_status_idx" ON "GoodsReceiptNote"("organizationId","status");

CREATE TABLE "GoodsReceiptLine" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "goodsReceiptId"     TEXT NOT NULL,
  "purchaseOrderLineId" TEXT,
  "productId"          TEXT,
  "description"        TEXT NOT NULL,
  "quantity"           DECIMAL(20,6) NOT NULL,
  "unitCost"           DECIMAL(20,6) NOT NULL DEFAULT 0,
  "batchNumber"        TEXT,
  "expiryDate"         TIMESTAMP(3),
  "notes"              TEXT,
  "lineNumber"         INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceiptNote"("id") ON DELETE CASCADE,
  CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL
);
CREATE INDEX "GoodsReceiptLine_organizationId_goodsReceiptId_idx" ON "GoodsReceiptLine"("organizationId","goodsReceiptId");

-- ===== Vendor bill → PO link =====
CREATE TABLE "VendorBillLink" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "vendorBillId"   TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "amount"         DECIMAL(20,6) NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorBillLink_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE,
  UNIQUE ("vendorBillId","purchaseOrderId")
);
CREATE INDEX "VendorBillLink_organizationId_vendorBillId_idx" ON "VendorBillLink"("organizationId","vendorBillId");
CREATE INDEX "VendorBillLink_organizationId_purchaseOrderId_idx" ON "VendorBillLink"("organizationId","purchaseOrderId");

-- ===== Three-way match =====
CREATE TABLE "ThreeWayMatch" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "purchaseOrderId"     TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "productId"           TEXT,
  "orderedQuantity"     DECIMAL(20,6) NOT NULL,
  "receivedQuantity"    DECIMAL(20,6) NOT NULL DEFAULT 0,
  "billedQuantity"      DECIMAL(20,6) NOT NULL DEFAULT 0,
  "orderedUnitPrice"    DECIMAL(20,6) NOT NULL,
  "billedUnitPrice"     DECIMAL(20,6),
  "quantityVariance"    DECIMAL(20,6) NOT NULL DEFAULT 0,
  "priceVariance"       DECIMAL(20,6) NOT NULL DEFAULT 0,
  "status"              "MatchStatus" NOT NULL DEFAULT 'pending',
  "thresholdExceeded"   BOOLEAN NOT NULL DEFAULT false,
  "notes"               TEXT,
  "lastCheckedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ThreeWayMatch_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE,
  UNIQUE ("purchaseOrderLineId")
);
CREATE INDEX "ThreeWayMatch_organizationId_purchaseOrderId_idx" ON "ThreeWayMatch"("organizationId","purchaseOrderId");
CREATE INDEX "ThreeWayMatch_organizationId_status_idx" ON "ThreeWayMatch"("organizationId","status");

-- ===== Debit notes =====
CREATE TABLE "DebitNote" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "noteNumber"      TEXT NOT NULL,
  "direction"       TEXT NOT NULL DEFAULT 'outbound',
  "partnerId"       TEXT NOT NULL,
  "documentId"      TEXT,
  "reason"          "DebitNoteReason" NOT NULL DEFAULT 'other',
  "reasonNote"      TEXT,
  "issueDate"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currencyCode"    TEXT NOT NULL DEFAULT 'USD',
  "exchangeRate"    DECIMAL(18,8) NOT NULL DEFAULT 1,
  "subtotal"        DECIMAL(20,6) NOT NULL DEFAULT 0,
  "taxAmount"       DECIMAL(20,6) NOT NULL DEFAULT 0,
  "totalAmount"     DECIMAL(20,6) NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "postedAt"        TIMESTAMP(3),
  "postedById"      TEXT,
  "notes"           TEXT,
  "customFields"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"       TIMESTAMP(3),
  "createdBy"       TEXT,
  "updatedBy"       TEXT,
  UNIQUE ("organizationId","noteNumber")
);
CREATE INDEX "DebitNote_organizationId_partnerId_idx" ON "DebitNote"("organizationId","partnerId");
CREATE INDEX "DebitNote_organizationId_direction_status_idx" ON "DebitNote"("organizationId","direction","status");

CREATE TABLE "DebitNoteLine" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "debitNoteId"    TEXT NOT NULL,
  "productId"      TEXT,
  "description"    TEXT NOT NULL,
  "quantity"       DECIMAL(20,6) NOT NULL,
  "unitPrice"      DECIMAL(20,6) NOT NULL,
  "taxId"          TEXT,
  "taxAmount"      DECIMAL(20,6) NOT NULL DEFAULT 0,
  "subtotal"       DECIMAL(20,6) NOT NULL DEFAULT 0,
  "total"          DECIMAL(20,6) NOT NULL DEFAULT 0,
  "lineNumber"     INTEGER NOT NULL DEFAULT 0,
  "notes"          TEXT,
  CONSTRAINT "DebitNoteLine_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "DebitNote"("id") ON DELETE CASCADE
);
CREATE INDEX "DebitNoteLine_organizationId_debitNoteId_idx" ON "DebitNoteLine"("organizationId","debitNoteId");

-- ===== Push notification subscriptions =====
CREATE TABLE "PushSubscription" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "endpoint"       TEXT NOT NULL UNIQUE,
  "p256dh"         TEXT NOT NULL,
  "auth"           TEXT NOT NULL,
  "userAgent"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"      TIMESTAMP(3)
);
CREATE INDEX "PushSubscription_organizationId_userId_idx" ON "PushSubscription"("organizationId","userId");

-- ===== Domain event log (append-only) =====
CREATE TABLE "DomainEventLog" (
  "id"             BIGSERIAL NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "eventName"      TEXT NOT NULL,
  "entityType"     TEXT NOT NULL,
  "entityId"       TEXT NOT NULL,
  "actorId"        TEXT,
  "payload"        JSONB NOT NULL,
  "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DomainEventLog_organizationId_occurredAt_idx" ON "DomainEventLog"("organizationId","occurredAt");
CREATE INDEX "DomainEventLog_organizationId_entityType_entityId_idx" ON "DomainEventLog"("organizationId","entityType","entityId");

-- Append-only enforcement: forbid UPDATE/DELETE on DomainEventLog so the
-- audit trail cannot be tampered with at the application level.
CREATE OR REPLACE FUNCTION deny_modify_domain_event_log() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DomainEventLog is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER deny_update_domain_event_log BEFORE UPDATE ON "DomainEventLog"
  FOR EACH ROW EXECUTE FUNCTION deny_modify_domain_event_log();
CREATE TRIGGER deny_delete_domain_event_log BEFORE DELETE ON "DomainEventLog"
  FOR EACH ROW EXECUTE FUNCTION deny_modify_domain_event_log();
