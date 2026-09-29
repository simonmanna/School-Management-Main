-- Wave 16: guardians request pick-up authorizations from the parent portal.
-- A request is not valid at the gate until the office approves it.
ALTER TABLE "PickupAuthorization" ADD COLUMN "pendingSince" TIMESTAMP(3);
ALTER TABLE "PickupAuthorization" ADD COLUMN "requestedByUserId" TEXT;
CREATE INDEX "PickupAuthorization_pending_idx" ON "PickupAuthorization" ("organizationId", "pendingSince") WHERE "pendingSince" IS NOT NULL;
