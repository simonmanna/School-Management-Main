-- School Document Management (P0-P2): unified SchoolDoc + versioning.

CREATE TABLE "SchoolDoc" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL DEFAULT 'student',
  "ownerId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'other',
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "signatureFileId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3),
  "accessRoles" JSONB NOT NULL DEFAULT '[]',
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "signedById" TEXT,
  "notes" TEXT,
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  CONSTRAINT "SchoolDoc_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolDoc_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SchoolDoc_signatureFileId_fkey" FOREIGN KEY ("signatureFileId") REFERENCES "File" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SchoolDoc_organizationId_idx" ON "SchoolDoc" ("organizationId");
CREATE INDEX "SchoolDoc_org_owner_idx" ON "SchoolDoc" ("organizationId", "ownerType", "ownerId");
CREATE INDEX "SchoolDoc_category_idx" ON "SchoolDoc" ("organizationId", "category");
CREATE INDEX "SchoolDoc_expires_idx" ON "SchoolDoc" ("organizationId", "expiresAt");

CREATE TABLE "SchoolDocVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "schoolDocId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "fileId" TEXT,
  "changeNote" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchoolDocVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolDocVersion_schoolDocId_fkey" FOREIGN KEY ("schoolDocId") REFERENCES "SchoolDoc" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolDocVersion_schoolDocId_versionNo_key" ON "SchoolDocVersion" ("schoolDocId", "versionNo");
CREATE INDEX "SchoolDocVersion_organizationId_idx" ON "SchoolDocVersion" ("organizationId");
CREATE INDEX "SchoolDocVersion_schoolDocId_idx" ON "SchoolDocVersion" ("schoolDocId");
