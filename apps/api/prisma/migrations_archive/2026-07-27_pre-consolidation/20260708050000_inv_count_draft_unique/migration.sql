-- Partial unique index: at most one draft session per (org, location, countType).
-- This prevents the concurrent-start race condition where two requests both pass
-- the "existing draft" check and create duplicate sessions.
CREATE UNIQUE INDEX "InventoryCountSession_draft_location_count_type_key"
ON "InventoryCountSession" ("organizationId", "locationId", "countType")
WHERE status = 'draft';
