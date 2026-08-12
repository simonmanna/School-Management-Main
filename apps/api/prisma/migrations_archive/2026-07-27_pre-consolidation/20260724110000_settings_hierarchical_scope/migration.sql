-- Hierarchical settings scope (ADR-005).
-- Adds scopeType/scopeId so a setting resolves most-specific-first
--   product -> category -> warehouse -> organization.
-- scopeId "" = the whole organization, keeping the unique index NULL-free
-- (Postgres treats NULLs as distinct, which would otherwise let duplicate
-- org-level rows slip through). Existing rows default to organization level.
-- Legacy `scope`/`module` columns are retained for backward compatibility.

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "scopeType" TEXT NOT NULL DEFAULT 'organization',
ADD COLUMN     "scopeId" TEXT NOT NULL DEFAULT '';

-- DropIndex (superseded by the scopeType/scopeId-aware unique below)
DROP INDEX "Setting_organizationId_scope_key_key";

-- CreateIndex
CREATE UNIQUE INDEX "Setting_organizationId_scopeType_scopeId_key_key" ON "Setting"("organizationId", "scopeType", "scopeId", "key");

-- CreateIndex
CREATE INDEX "Setting_organizationId_scopeType_scopeId_idx" ON "Setting"("organizationId", "scopeType", "scopeId");
