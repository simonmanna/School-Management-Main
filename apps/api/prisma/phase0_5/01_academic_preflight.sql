-- Read-only Phase 0 inventory. Run with ON_ERROR_STOP=1 against a restored copy.
-- It records volume and surfaces conditions that must be resolved before Phase 1.
BEGIN TRANSACTION READ ONLY;

SELECT 'StudentProfile' AS entity, count(*) AS rows FROM "StudentProfile"
UNION ALL SELECT 'Enrollment', count(*) FROM "Enrollment"
UNION ALL SELECT 'CourseOffering', count(*) FROM "CourseOffering"
UNION ALL SELECT 'HomeworkAssignment', count(*) FROM "HomeworkAssignment"
UNION ALL SELECT 'Assessment', count(*) FROM "Assessment"
UNION ALL SELECT 'StudentAssessment', count(*) FROM "StudentAssessment"
UNION ALL SELECT 'MarkEntry', count(*) FROM "MarkEntry"
UNION ALL SELECT 'GradeEntry', count(*) FROM "GradeEntry"
UNION ALL SELECT 'AcademicRoster', count(*) FROM "AcademicRoster"
UNION ALL SELECT 'ResultSet', count(*) FROM "ResultSet"
UNION ALL SELECT 'ReportCard', count(*) FROM "ReportCard"
ORDER BY entity;

-- Active learners with no enrollment for any term.
SELECT sp."organizationId", count(*) AS active_without_enrollment
FROM "StudentProfile" sp
WHERE sp.status = 'active' AND sp."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Enrollment" e WHERE e."studentProfileId" = sp.id)
GROUP BY sp."organizationId";

-- Projection drift: current placement disagrees with the newest enrollment.
WITH latest AS (
  SELECT DISTINCT ON (e."studentProfileId") e.*
  FROM "Enrollment" e
  ORDER BY e."studentProfileId", e."enrolledAt" DESC, e."createdAt" DESC
)
SELECT sp."organizationId", count(*) AS projection_mismatches
FROM "StudentProfile" sp JOIN latest e ON e."studentProfileId" = sp.id
WHERE sp."currentClassId" IS DISTINCT FROM e."classId"
   OR sp."currentSectionId" IS DISTINCT FROM e."sectionId"
   OR sp."currentStreamId" IS DISTINCT FROM e."streamId"
GROUP BY sp."organizationId";

-- Invalid scores and marks without a frozen roster member.
SELECT count(*) AS invalid_effective_scores
FROM "StudentAssessment"
WHERE "effectiveScore" < 0 OR "effectiveScore" > "maxScore";

SELECT count(*) AS assessments_without_matching_roster
FROM "Assessment" a
WHERE a.status <> 'draft'
  AND NOT EXISTS (
    SELECT 1 FROM "AcademicRoster" r
    WHERE r."organizationId" = a."organizationId"
      AND r."termId" = a."termId"
      AND (r."classId" = a."classId" OR r."classId" IS NULL)
  );

COMMIT;
