-- Wave 18: a tie-out that could not run is recorded as such, never as balanced.
ALTER TABLE "ReportTieoutSnapshot" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ran', ADD COLUMN "reason" TEXT;
