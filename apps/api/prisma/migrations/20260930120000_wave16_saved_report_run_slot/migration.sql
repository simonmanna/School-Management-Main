-- Wave 16: one scheduled run per (report, slot), claimed by the unique index.
CREATE UNIQUE INDEX "SavedReportRun_reportId_scheduledFor_key" ON "SavedReportRun"("reportId", "scheduledFor");
