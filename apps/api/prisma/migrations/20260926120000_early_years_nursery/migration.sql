-- CreateEnum
CREATE TYPE "CareMood" AS ENUM ('happy', 'settled', 'tired', 'tearful', 'unsettled', 'unwell');

-- CreateEnum
CREATE TYPE "CareMealPortion" AS ENUM ('all', 'most', 'some', 'none');

-- CreateEnum
CREATE TYPE "PickupAuthorizationKind" AS ENUM ('STANDING', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "ChildIncidentKind" AS ENUM ('INJURY', 'ILLNESS', 'BEHAVIOUR', 'SAFEGUARDING', 'NEAR_MISS', 'OTHER');

-- CreateEnum
CREATE TYPE "ChildIncidentSeverity" AS ENUM ('MINOR', 'MODERATE', 'SERIOUS');

-- AlterTable
ALTER TABLE "AcademicLevel" ADD COLUMN     "staffChildRatio" INTEGER;

-- AlterTable
ALTER TABLE "GradeLevel" ADD COLUMN     "maxAgeMonths" INTEGER,
ADD COLUMN     "minAgeMonths" INTEGER;

-- CreateTable
CREATE TABLE "ChildCareLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "onDate" DATE NOT NULL,
    "arrivalMood" "CareMood",
    "departureMood" "CareMood",
    "meals" JSONB NOT NULL DEFAULT '[]',
    "naps" JSONB NOT NULL DEFAULT '[]',
    "nappyChanges" INTEGER,
    "usedToiletAlone" BOOLEAN,
    "activities" TEXT,
    "teacherNote" TEXT,
    "sharedAt" TIMESTAMP(3),
    "sharedById" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChildCareLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupAuthorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "kind" "PickupAuthorizationKind" NOT NULL DEFAULT 'STANDING',
    "contactId" TEXT,
    "personName" TEXT,
    "personPhone" TEXT,
    "relationship" TEXT,
    "idType" TEXT,
    "idNumber" TEXT,
    "photoDocumentId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "authorizedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "authorizationId" TEXT,
    "collectedByName" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "overrideReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildIncident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "kind" "ChildIncidentKind" NOT NULL,
    "severity" "ChildIncidentSeverity" NOT NULL DEFAULT 'MINOR',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "bodyPart" TEXT,
    "firstAidById" TEXT,
    "guardianNotifiedAt" TIMESTAMP(3),
    "guardianNotifiedById" TEXT,
    "guardianNotifiedHow" TEXT,
    "recordedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChildIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImmunisationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "vaccine" TEXT NOT NULL,
    "doseLabel" TEXT,
    "administeredOn" DATE,
    "nextDueOn" DATE,
    "certificateDocumentId" TEXT,
    "exemptionReason" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ImmunisationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildCareLog_organizationId_idx" ON "ChildCareLog"("organizationId");

-- CreateIndex
CREATE INDEX "ChildCareLog_organizationId_onDate_idx" ON "ChildCareLog"("organizationId", "onDate");

-- CreateIndex
CREATE INDEX "ChildCareLog_studentProfileId_onDate_idx" ON "ChildCareLog"("studentProfileId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChildCareLog_organizationId_studentProfileId_onDate_key" ON "ChildCareLog"("organizationId", "studentProfileId", "onDate");

-- CreateIndex
CREATE INDEX "PickupAuthorization_organizationId_idx" ON "PickupAuthorization"("organizationId");

-- CreateIndex
CREATE INDEX "PickupAuthorization_studentProfileId_idx" ON "PickupAuthorization"("studentProfileId");

-- CreateIndex
CREATE INDEX "PickupAuthorization_organizationId_validFrom_idx" ON "PickupAuthorization"("organizationId", "validFrom");

-- CreateIndex
CREATE INDEX "PickupEvent_organizationId_idx" ON "PickupEvent"("organizationId");

-- CreateIndex
CREATE INDEX "PickupEvent_studentProfileId_collectedAt_idx" ON "PickupEvent"("studentProfileId", "collectedAt");

-- CreateIndex
CREATE INDEX "PickupEvent_organizationId_collectedAt_idx" ON "PickupEvent"("organizationId", "collectedAt");

-- CreateIndex
CREATE INDEX "ChildIncident_organizationId_idx" ON "ChildIncident"("organizationId");

-- CreateIndex
CREATE INDEX "ChildIncident_studentProfileId_occurredAt_idx" ON "ChildIncident"("studentProfileId", "occurredAt");

-- CreateIndex
CREATE INDEX "ChildIncident_organizationId_severity_occurredAt_idx" ON "ChildIncident"("organizationId", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "ImmunisationRecord_organizationId_idx" ON "ImmunisationRecord"("organizationId");

-- CreateIndex
CREATE INDEX "ImmunisationRecord_studentProfileId_idx" ON "ImmunisationRecord"("studentProfileId");

-- CreateIndex
CREATE INDEX "ImmunisationRecord_organizationId_nextDueOn_idx" ON "ImmunisationRecord"("organizationId", "nextDueOn");

-- AddForeignKey
ALTER TABLE "ChildCareLog" ADD CONSTRAINT "ChildCareLog_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupAuthorization" ADD CONSTRAINT "PickupAuthorization_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupAuthorization" ADD CONSTRAINT "PickupAuthorization_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupEvent" ADD CONSTRAINT "PickupEvent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupEvent" ADD CONSTRAINT "PickupEvent_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "PickupAuthorization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildIncident" ADD CONSTRAINT "ChildIncident_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImmunisationRecord" ADD CONSTRAINT "ImmunisationRecord_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row-Level Security for the five new org-scoped tables.
--
-- A table created without a tenant_isolation policy has NO database-level
-- isolation: the app-layer scoping in tenancy.extension.ts is then the only
-- thing between two schools' children. These tables hold a nursery's care
-- notes, who may collect a child, and its incident log, so that is not a
-- risk worth carrying for one release.
--
-- Same catalog-driven block as 20260923100000_rls_enable_all_org_tables, which
-- is idempotent, so this also re-covers anything added since.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_attribute a  ON a.attrelid = c.oid
        WHERE ns.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'organizationId'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        IF EXISTS (
            SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = t AND a.attname = 'organizationId' AND NOT a.attnotnull
        ) THEN
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" IS NULL OR "organizationId" = current_setting(''app.org_id'', true))
                 WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        ELSE
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        END IF;
    END LOOP;
END $$;
