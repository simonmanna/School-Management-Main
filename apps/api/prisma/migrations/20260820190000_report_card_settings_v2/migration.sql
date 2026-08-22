-- Report card settings v2 — extensible configuration.
--
-- The v1 table carried one real column per option, so every new customisation
-- option needed a migration. v2 adds a JSONB `config` blob: the original
-- columns stay (they are read directly by the report-card viewer and by
-- existing tenants) while every new option lives in `config`, keyed by the
-- field registry in report-card-settings.schema.ts.
ALTER TABLE "ReportCardSettings"
  ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Which named preset was last applied ('classic' | 'modern' | …), or NULL for
-- a hand-tuned configuration. Purely informational — the resolved settings
-- always come from the columns + config blob, never from the preset key.
ALTER TABLE "ReportCardSettings"
  ADD COLUMN IF NOT EXISTS "presetKey" TEXT;
