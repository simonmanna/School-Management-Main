-- School Management config: generic policy store + reusable custom-field definitions.
-- (SchoolCalendarEvent already exists from the academics foundation migration.)

CREATE TABLE "SchoolPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SchoolPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolPolicy_organizationId_key_key" ON "SchoolPolicy" ("organizationId", "key");
CREATE INDEX "SchoolPolicy_organizationId_idx" ON "SchoolPolicy" ("organizationId");
CREATE INDEX "SchoolPolicy_organizationId_category_idx" ON "SchoolPolicy" ("organizationId", "category");

CREATE UNIQUE INDEX "CustomField_organizationId_entityType_name_key" ON "CustomField" ("organizationId", "entityType", "name");
CREATE INDEX "CustomField_organizationId_idx" ON "CustomField" ("organizationId");
CREATE INDEX "CustomField_organizationId_entityType_idx" ON "CustomField" ("organizationId", "entityType");
