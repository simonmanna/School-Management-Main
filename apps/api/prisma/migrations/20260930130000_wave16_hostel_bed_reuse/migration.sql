-- Wave 16: a bed is allocated again after checkout. The old @unique on bedId
-- made every bed single-use for the life of the database; the rule is one
-- ACTIVE allocation per bed, and one active bed per pupil.
DROP INDEX IF EXISTS "HostelAllocation_bedId_key";
CREATE INDEX "HostelAllocation_bedId_idx" ON "HostelAllocation"("bedId");
CREATE UNIQUE INDEX "HostelAllocation_one_active_per_bed"
  ON "HostelAllocation" ("bedId") WHERE "status" = 'active';
CREATE UNIQUE INDEX "HostelAllocation_one_active_per_student"
  ON "HostelAllocation" ("organizationId", "studentProfileId") WHERE "status" = 'active';
