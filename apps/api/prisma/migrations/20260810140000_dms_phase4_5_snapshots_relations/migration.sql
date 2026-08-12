-- Phase 4/5 — DMS snapshots, templates (rendering), relations, sources,
-- versions, attachments. All additive (no ALTER of existing tables).
-- Hand-written (repo rule: never `prisma migrate dev`; use migrate deploy).

-- §5.3 — document-owned content JSON (amend writes; RLS-neutral column).
ALTER TABLE "Document" ADD COLUMN "data" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- TemplateDefinition (GLOBAL registry row — no organizationId, no RLS)
CREATE TABLE "TemplateDefinition" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'plain',
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "headerFooter" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateDefinition_pkey" PRIMARY KEY ("id")
);

-- DocumentSnapshot (org-scoped)
CREATE TABLE "DocumentSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "templateVersionId" TEXT,
    "renderedFileId" TEXT,
    "seal" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'post',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "DocumentSnapshot_pkey" PRIMARY KEY ("id")
);

-- DocumentRelation (org-scoped)
CREATE TABLE "DocumentRelation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "relationTypeId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRelation_pkey" PRIMARY KEY ("id")
);

-- DocumentSource (org-scoped)
CREATE TABLE "DocumentSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'primary',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSource_pkey" PRIMARY KEY ("id")
);

-- DocumentVersion (org-scoped)
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "changeNote" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- DocumentAttachment (org-scoped)
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ATTACHMENT',
    "kind" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_documentTypeId_fkey"
    FOREIGN KEY ("documentTypeId") REFERENCES "DocumentTypeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentSnapshot" ADD CONSTRAINT "DocumentSnapshot_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_fromDocumentId_fkey"
    FOREIGN KEY ("fromDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_toDocumentId_fkey"
    FOREIGN KEY ("toDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_relationTypeId_fkey"
    FOREIGN KEY ("relationTypeId") REFERENCES "DocumentRelationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentSource" ADD CONSTRAINT "DocumentSource_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraints
ALTER TABLE "TemplateDefinition" ADD CONSTRAINT "TemplateDefinition_templateKey_version_key"
    UNIQUE ("templateKey", "version");

ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_fromDocumentId_toDocumentId_relationTypeId_key"
    UNIQUE ("fromDocumentId", "toDocumentId", "relationTypeId");

ALTER TABLE "DocumentSource" ADD CONSTRAINT "DocumentSource_documentId_sourceType_sourceId_key"
    UNIQUE ("documentId", "sourceType", "sourceId");

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_versionNo_key"
    UNIQUE ("documentId", "versionNo");

-- Indexes
CREATE INDEX "TemplateDefinition_documentTypeId_idx" ON "TemplateDefinition"("documentTypeId");
CREATE INDEX "TemplateDefinition_templateKey_format_idx" ON "TemplateDefinition"("templateKey", "format");

CREATE INDEX "DocumentSnapshot_organizationId_idx" ON "DocumentSnapshot"("organizationId");
CREATE INDEX "DocumentSnapshot_documentId_generatedAt_idx" ON "DocumentSnapshot"("documentId", "generatedAt");

CREATE INDEX "DocumentRelation_organizationId_idx" ON "DocumentRelation"("organizationId");
CREATE INDEX "DocumentRelation_fromDocumentId_idx" ON "DocumentRelation"("fromDocumentId");
CREATE INDEX "DocumentRelation_toDocumentId_idx" ON "DocumentRelation"("toDocumentId");
CREATE INDEX "DocumentRelation_relationTypeId_idx" ON "DocumentRelation"("relationTypeId");

CREATE INDEX "DocumentSource_organizationId_idx" ON "DocumentSource"("organizationId");
CREATE INDEX "DocumentSource_sourceType_sourceId_idx" ON "DocumentSource"("sourceType", "sourceId");

CREATE INDEX "DocumentVersion_organizationId_idx" ON "DocumentVersion"("organizationId");
CREATE INDEX "DocumentVersion_documentId_idx" ON "DocumentVersion"("documentId");

CREATE INDEX "DocumentAttachment_organizationId_idx" ON "DocumentAttachment"("organizationId");
CREATE INDEX "DocumentAttachment_documentId_role_idx" ON "DocumentAttachment"("documentId", "role");
CREATE INDEX "DocumentAttachment_fileId_idx" ON "DocumentAttachment"("fileId");