-- Fee Waiver Categories + Waiver extensions. Applied via psql (Prisma client regen blocked by OneDrive lock).

CREATE TABLE IF NOT EXISTS "WaiverCategory" (
  "id"             TEXT    NOT NULL,
  "organizationId" TEXT    NOT NULL,
  "code"           TEXT    NOT NULL,
  "name"           TEXT    NOT NULL,
  "description"    TEXT,
  "type"           TEXT    NOT NULL DEFAULT 'percentage',
  "value"          DECIMAL(20,6) NOT NULL DEFAULT 0,
  "defaultReason"  TEXT,
  "appliesTo"      JSONB   NOT NULL DEFAULT '{}',
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WaiverCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaiverCategory_organizationId_code_key" ON "WaiverCategory"("organizationId","code");
CREATE INDEX IF NOT EXISTS "WaiverCategory_organizationId_idx" ON "WaiverCategory"("organizationId");

-- Extend existing Waiver table (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Waiver' AND column_name='waiverCategoryId') THEN
    ALTER TABLE "Waiver" ADD COLUMN "waiverCategoryId" TEXT;
    CREATE INDEX IF NOT EXISTS "Waiver_waiverCategoryId_idx" ON "Waiver"("waiverCategoryId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='Waiver' AND column_name='badDebt') THEN
    ALTER TABLE "Waiver" ADD COLUMN "badDebt" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;
