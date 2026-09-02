-- Phase 0.5 reconciliation contract. Read-only and safe on production, though
-- the release process runs it against staging and a restored production copy.
BEGIN TRANSACTION READ ONLY;

-- Legacy GradeEntry -> canonical StudentAssessment parity.
SELECT
  count(*) AS old_records,
  count(*) FILTER (WHERE sa.id IS NOT NULL) AS mapped_records,
  count(*) FILTER (WHERE sa.id IS NULL) AS unmapped_records,
  count(*) FILTER (WHERE sa.id IS NOT NULL AND ge."marksObtained" IS DISTINCT FROM sa."effectiveScore") AS score_differences
FROM "GradeEntry" ge
LEFT JOIN "Assessment" a ON a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
LEFT JOIN "StudentAssessment" sa ON sa."assessmentId" = a.id AND sa."studentProfileId" = ge."studentProfileId";

-- Homework -> Assignment mapping through Assessment.sourceRef.
SELECT
  count(*) AS old_records,
  count(*) FILTER (WHERE a.id IS NOT NULL) AS mapped_records,
  count(*) FILTER (WHERE a.id IS NULL) AS unmapped_records
FROM "HomeworkAssignment" h
LEFT JOIN "Assessment" s ON s.id = h."assessmentId"
LEFT JOIN "Assignment" a ON a."assessmentId" = s.id;

-- Duplicate learner/assessment truths are always a stop-ship.
SELECT "assessmentId", "studentProfileId", count(*) AS duplicates
FROM "StudentAssessment"
GROUP BY "assessmentId", "studentProfileId"
HAVING count(*) > 1;

-- Every published result must have checksums and a reproducible source roster.
SELECT id, "organizationId", revision, "inputChecksum", "outputChecksum", "rosterId"
FROM "ResultSet"
WHERE status IN ('published', 'locked', 'archived')
  AND ("inputChecksum" IS NULL OR "outputChecksum" IS NULL OR "rosterId" IS NULL);

COMMIT;
