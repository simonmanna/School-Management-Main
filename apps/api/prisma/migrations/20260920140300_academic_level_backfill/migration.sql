-- Backfill AcademicLevel from existing programme banding (ADR-028).
--
-- The rule: **one level per AcademicProgramme that actually bands grade levels.**
-- A school that had already separated "Lower Primary" from "Upper Primary" keeps
-- that separation; nothing is merged and nothing is invented.
--
-- Grade levels with no `ProgrammeGradeLevel` row get an
-- `AcademicMigrationException` rather than a guessed band. Guessing here is
-- exactly the failure mode this redesign exists to remove: a grade silently
-- assigned to the wrong band resolves to the wrong programme, and the wrong
-- programme decides how the learner is assessed.
--
-- Every statement is guarded, so re-running is a no-op.

-- ── levels, derived from banding programmes ──────────────────────────────────
-- `id` is derived deterministically from the programme id rather than random, so
-- a re-run maps the same programme to the same level even if the INSERT below is
-- ever interrupted partway.
INSERT INTO "AcademicLevel" (
  "id", "organizationId", "name", "code", "description", "displayOrder",
  "isActive", "stage", "defaultProgrammeId", "createdAt", "updatedAt"
)
SELECT
  md5('academiclevel:' || p."id")::uuid::text,
  p."organizationId",
  p."name",
  p."code",
  p."description",
  row_number() OVER (PARTITION BY p."organizationId" ORDER BY p."stage", p."code"),
  p."isActive",
  p."stage",
  p."id",
  now(),
  now()
FROM "AcademicProgramme" p
WHERE p."deletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "ProgrammeGradeLevel" g WHERE g."programmeId" = p."id")
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- ── attach grade levels to their band ────────────────────────────────────────
UPDATE "GradeLevel" gl
   SET "academicLevelId" = al."id"
  FROM "ProgrammeGradeLevel" pgl
  JOIN "AcademicLevel" al ON al."defaultProgrammeId" = pgl."programmeId"
 WHERE pgl."gradeLevelId" = gl."id"
   AND gl."academicLevelId" IS NULL;

-- ── a default band for schools that never banded anything ────────────────────
-- Programmes were a Phase-1 feature that most tenants never adopted: in this
-- database 821 organizations have real students and no programme at all. Banding
-- only from programmes would leave ~97% of grade levels with no level, an
-- exception queue of 1,576 rows nobody would ever clear, and `academicLevelId`
-- could never become required.
--
-- So: an organization that has drawn NO distinction between its grades gets ONE
-- level containing all of them. That is not a guess about which band a grade
-- belongs to — it is the only accurate description of a school that has made no
-- such distinction. The school can rename it, or split it, at any time.
--
-- Deliberately neutral: no name here implies Primary, Nursery or any country's
-- structure. Inferring "P4 must be Primary" from the name is exactly the
-- hard-coding this redesign exists to remove.
--
-- This applies ONLY to organizations with no level at all. An organization that
-- HAS banding but left a grade out is genuinely ambiguous and is queued below.
INSERT INTO "AcademicLevel" (
  "id", "organizationId", "name", "code", "description", "displayOrder",
  "isActive", "stage", "createdAt", "updatedAt"
)
SELECT
  md5('academiclevel:default:' || g."organizationId")::uuid::text,
  g."organizationId",
  'General',
  'GENERAL',
  'Created automatically because this school had not separated its grades into levels. Rename it, or add more levels and move grades between them.',
  1,
  true,
  'OTHER',
  now(),
  now()
FROM "GradeLevel" g
WHERE g."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AcademicLevel" al WHERE al."organizationId" = g."organizationId"
  )
GROUP BY g."organizationId"
ON CONFLICT ("organizationId", "code") DO NOTHING;

UPDATE "GradeLevel" gl
   SET "academicLevelId" = al."id"
  FROM "AcademicLevel" al
 WHERE al."organizationId" = gl."organizationId"
   AND al."code" = 'GENERAL'
   AND gl."academicLevelId" IS NULL
   AND gl."deletedAt" IS NULL;

-- ── queue what could not be resolved ─────────────────────────────────────────
-- Nothing is silently discarded (ADR-027 §exception queue). What reaches here is
-- the genuinely ambiguous case: an organization that DID separate its grades into
-- levels, but left this one out. Guessing which band it belongs to would be
-- inventing a distinction the school's own configuration contradicts.
--
-- `migrationRunId` is fixed for this migration so a re-run updates the same
-- logical queue rather than duplicating it; the NOT EXISTS guard does the rest.
INSERT INTO "AcademicMigrationException" (
  "id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason",
  "payload", "createdAt"
)
SELECT
  md5('alexception:' || gl."id")::uuid::text,
  gl."organizationId",
  '20260920140300_academic_level_backfill',
  'GradeLevel',
  gl."id",
  'This school separates its grades into academic levels, but this grade belongs to none of them. Assign it a level before GradeLevel.academicLevelId becomes required.',
  jsonb_build_object('name', gl."name", 'code', gl."code", 'order', gl."order"),
  now()
FROM "GradeLevel" gl
WHERE gl."deletedAt" IS NULL
  AND gl."academicLevelId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "AcademicMigrationException" e
     WHERE e."sourceEntity" = 'GradeLevel'
       AND e."sourceId" = gl."id"
       AND e."migrationRunId" = '20260920140300_academic_level_backfill'
  );

-- ── resolve queue entries that a later run fixed ─────────────────────────────
-- If a grade has since been given a band, its exception is closed rather than
-- left to rot in the queue. An exception list nobody can ever empty is one
-- nobody reads.
UPDATE "AcademicMigrationException" e
   SET "resolvedAt" = now(),
       "resolutionNote" = 'Grade level now has an academic level.'
  FROM "GradeLevel" gl
 WHERE e."sourceEntity" = 'GradeLevel'
   AND e."migrationRunId" = '20260920140300_academic_level_backfill'
   AND e."resolvedAt" IS NULL
   AND gl."id" = e."sourceId"
   AND gl."academicLevelId" IS NOT NULL;
