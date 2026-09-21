-- A default programme for every academic level that has none (ADR-028).
--
-- `StudentEnrollment.programmeId` is required. Enrollment creation resolves it
-- through the learner's grade: grade → academic level → default programme. The
-- level backfill gave the 980 organizations that had never separated their
-- grades a neutral GENERAL level — but no programme, because they had none. For
-- those schools the resolution returned nothing and not one canonical
-- enrollment could be created. That is why this database held 3,974 student
-- profiles against 389 canonical enrollments.
--
-- The fix mirrors the level decision exactly: a school that has drawn no
-- programme distinction gets ONE neutral programme, with an empty configuration
-- (every consumer of `config` already defaults a missing key), set as the
-- default for its levels that lack one. Nothing here implies a curriculum,
-- country or assessment model; a school replaces or refines it at will.
--
-- Additive and re-runnable.

INSERT INTO "AcademicProgramme" (
  "id", "organizationId", "code", "name", "stage", "groupingMode", "description",
  "effectiveFrom", "isActive", "config", "createdAt", "updatedAt"
)
SELECT
  md5('academicprogramme:general:' || l."organizationId")::uuid::text,
  l."organizationId",
  'GENERAL',
  'General',
  'OTHER',
  'SECTION_ONLY',
  'Created automatically so this school''s learners can be enrolled. It carries no curriculum or assessment rules of its own; refine it, or give each academic level its own programme.',
  date_trunc('year', now()),
  true,
  '{}'::jsonb,
  now(),
  now()
FROM "AcademicLevel" l
WHERE l."deletedAt" IS NULL
  AND l."defaultProgrammeId" IS NULL
GROUP BY l."organizationId"
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- Point every level without a default at its organization's GENERAL programme.
-- If a school already had a programme coded GENERAL, that one is used.
UPDATE "AcademicLevel" l
   SET "defaultProgrammeId" = p."id"
  FROM "AcademicProgramme" p
 WHERE p."organizationId" = l."organizationId"
   AND p."code" = 'GENERAL'
   AND p."deletedAt" IS NULL
   AND l."defaultProgrammeId" IS NULL
   AND l."deletedAt" IS NULL;
