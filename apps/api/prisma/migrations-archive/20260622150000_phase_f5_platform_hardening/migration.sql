-- Phase F.5 hardening: MFA secret encryption columns, notifications, files,
-- one-time tokens, approvals, recurring documents, webhooks, feature flags,
-- reports, and vertical module enablement.
-- See ADR-006 (audit), ADR-011 (vertical contract), and the F.5 plan.

-- ===== User: MFA encryption columns =====
ALTER TABLE "User"
  ADD COLUMN "mfaSecretIv"  TEXT,
  ADD COLUMN "mfaSecretTag" TEXT;

-- ===== Notifications =====
CREATE TYPE "NotificationChannel" AS ENUM ('in_app','email','sms','push');
CREATE TYPE "NotificationStatus" AS ENUM ('pending','sent','failed','read');

CREATE TABLE "Notification" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT,
  "channel"        "NotificationChannel" NOT NULL DEFAULT 'in_app',
  "category"       TEXT NOT NULL DEFAULT 'general',
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "payload"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status"         "NotificationStatus" NOT NULL DEFAULT 'pending',
  "readAt"         TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "error"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Notification_organizationId_userId_status_createdAt_idx"
  ON "Notification"("organizationId","userId","status","createdAt");
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status","createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId","readAt");

CREATE TABLE "NotificationPreference" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "channel"        "NotificationChannel" NOT NULL,
  "category"       TEXT NOT NULL DEFAULT 'general',
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","userId","channel","category")
);
CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");

-- ===== Files =====
CREATE TYPE "FileVisibility" AS ENUM ('private','org','public');
CREATE TABLE "File" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "uploadedById"   TEXT,
  "filename"       TEXT NOT NULL,
  "contentType"    TEXT NOT NULL,
  "byteSize"       INTEGER NOT NULL,
  "storageKey"     TEXT NOT NULL UNIQUE,
  "visibility"     "FileVisibility" NOT NULL DEFAULT 'private',
  "ownerType"      TEXT,
  "ownerId"        TEXT,
  "checksum"       TEXT,
  "encrypted"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "File_organizationId_ownerType_ownerId_idx"
  ON "File"("organizationId","ownerType","ownerId");
CREATE INDEX "File_organizationId_createdAt_idx" ON "File"("organizationId","createdAt");

-- ===== One-time tokens =====
CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('password_reset','email_verification','invite');
CREATE TABLE "OneTimeToken" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT,
  "userId"         TEXT,
  "tokenHash"      TEXT NOT NULL UNIQUE,
  "purpose"        "OneTimeTokenPurpose" NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "consumedAt"     TIMESTAMP(3),
  "payload"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OneTimeToken_userId_purpose_idx" ON "OneTimeToken"("userId","purpose");
CREATE INDEX "OneTimeToken_expiresAt_idx" ON "OneTimeToken"("expiresAt");

-- ===== Approvals =====
CREATE TYPE "ApprovalStatus" AS ENUM ('pending','approved','rejected','cancelled');
CREATE TABLE "ApprovalPolicy" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "organizationId"        TEXT NOT NULL,
  "name"                  TEXT NOT NULL,
  "entityType"            TEXT NOT NULL,
  "minAmount"             DECIMAL(20,6),
  "approverPermissions"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requiredCount"         INTEGER NOT NULL DEFAULT 1,
  "isActive"              BOOLEAN NOT NULL DEFAULT true,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ApprovalPolicy_organizationId_entityType_isActive_idx"
  ON "ApprovalPolicy"("organizationId","entityType","isActive");

CREATE TABLE "ApprovalRequest" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "entityType"      TEXT NOT NULL,
  "entityId"        TEXT NOT NULL,
  "snapshot"        JSONB NOT NULL,
  "policyId"        TEXT,
  "status"          "ApprovalStatus" NOT NULL DEFAULT 'pending',
  "requiredCount"   INTEGER NOT NULL DEFAULT 1,
  "decidedAt"       TIMESTAMP(3),
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE SET NULL
);
CREATE INDEX "ApprovalRequest_organizationId_entityType_entityId_idx"
  ON "ApprovalRequest"("organizationId","entityType","entityId");
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId","status");

CREATE TABLE "ApprovalDecision" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "requestId"      TEXT NOT NULL,
  "approverId"     TEXT NOT NULL,
  "status"         "ApprovalStatus" NOT NULL,
  "comment"        TEXT,
  "decidedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE,
  UNIQUE ("requestId","approverId")
);
CREATE INDEX "ApprovalDecision_organizationId_idx" ON "ApprovalDecision"("organizationId");

-- ===== Recurring documents =====
CREATE TYPE "RecurringFrequency" AS ENUM ('daily','weekly','monthly','quarterly','yearly');
CREATE TYPE "RecurringStatus" AS ENUM ('active','paused','ended');
CREATE TABLE "RecurringDocument" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "documentType"   "DocumentType" NOT NULL,
  "template"       JSONB NOT NULL,
  "frequency"      "RecurringFrequency" NOT NULL,
  "nextRunAt"      TIMESTAMP(3) NOT NULL,
  "lastRunAt"      TIMESTAMP(3),
  "endDate"        TIMESTAMP(3),
  "status"         "RecurringStatus" NOT NULL DEFAULT 'active',
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RecurringDocument_organizationId_status_nextRunAt_idx"
  ON "RecurringDocument"("organizationId","status","nextRunAt");

CREATE TABLE "RecurringDocumentRun" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "recurringId"    TEXT NOT NULL,
  "scheduledFor"   TIMESTAMP(3) NOT NULL,
  "ranAt"          TIMESTAMP(3),
  "documentId"     TEXT,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "error"          TEXT,
  CONSTRAINT "RecurringDocumentRun_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringDocument"("id") ON DELETE CASCADE,
  UNIQUE ("recurringId","scheduledFor")
);
CREATE INDEX "RecurringDocumentRun_organizationId_status_scheduledFor_idx"
  ON "RecurringDocumentRun"("organizationId","status","scheduledFor");

-- ===== Webhooks =====
CREATE TYPE "WebhookEventStatus" AS ENUM ('pending','succeeded','failed','dead');
CREATE TABLE "WebhookEndpoint" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "events"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "signingSecret"  TEXT NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "description"    TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"      TIMESTAMP(3)
);
CREATE INDEX "WebhookEndpoint_organizationId_isActive_idx" ON "WebhookEndpoint"("organizationId","isActive");

CREATE TABLE "WebhookDelivery" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "endpointId"     TEXT NOT NULL,
  "eventName"      TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         "WebhookEventStatus" NOT NULL DEFAULT 'pending',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt"  TIMESTAMP(3),
  "nextAttemptAt"  TIMESTAMP(3),
  "succeededAt"    TIMESTAMP(3),
  "responseStatus" INTEGER,
  "responseBody"   TEXT,
  "error"          TEXT,
  CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE
);
CREATE INDEX "WebhookDelivery_organizationId_status_nextAttemptAt_idx"
  ON "WebhookDelivery"("organizationId","status","nextAttemptAt");
CREATE INDEX "WebhookDelivery_endpointId_idx" ON "WebhookDelivery"("endpointId");

-- ===== Feature flags =====
CREATE TABLE "FeatureFlag" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "payload"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("organizationId","key")
);
CREATE INDEX "FeatureFlag_organizationId_idx" ON "FeatureFlag"("organizationId");

-- ===== Saved reports =====
CREATE TABLE "SavedReport" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "reportKey"      TEXT NOT NULL,
  "parameters"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "schedule"       TEXT,
  "format"         TEXT NOT NULL DEFAULT 'csv',
  "emailTo"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SavedReport_organizationId_reportKey_idx" ON "SavedReport"("organizationId","reportKey");

CREATE TABLE "SavedReportRun" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "reportId"       TEXT NOT NULL,
  "scheduledFor"   TIMESTAMP(3) NOT NULL,
  "ranAt"          TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "fileId"         TEXT,
  "error"          TEXT,
  CONSTRAINT "SavedReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SavedReport"("id") ON DELETE CASCADE
);
CREATE INDEX "SavedReportRun_organizationId_status_scheduledFor_idx"
  ON "SavedReportRun"("organizationId","status","scheduledFor");

-- ===== Organization module enablement =====
CREATE TABLE "OrganizationModule" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "moduleName"     TEXT NOT NULL,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "config"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "enabledAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt"     TIMESTAMP(3),
  UNIQUE ("organizationId","moduleName")
);
CREATE INDEX "OrganizationModule_organizationId_isActive_idx"
  ON "OrganizationModule"("organizationId","isActive");

-- ===== Outbox claim columns for multi-instance safety =====
ALTER TABLE "EventOutbox"
  ADD COLUMN "claimToken"  TEXT,
  ADD COLUMN "claimedAt"   TIMESTAMP(3);
CREATE INDEX "EventOutbox_claimToken_idx" ON "EventOutbox"("claimToken");
