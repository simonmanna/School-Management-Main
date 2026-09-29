-- Wave 17 (audit R04): record each recipient's delivery outcome, so a run whose
-- email failed is no longer reported as succeeded.
ALTER TABLE "SavedReportRun" ADD COLUMN "deliveries" JSONB;
