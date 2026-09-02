-- Add receivedAt to Complaint
--
-- The Complaints UI renders a "Received" timestamp (c.receivedAt) but the model
-- had no such column, so the row was never persisted and the value was always
-- undefined. This adds a user-settable occurrence time (defaults to now) that
-- the front desk fills in when the complaint was actually received.

ALTER TABLE "Complaint" ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
