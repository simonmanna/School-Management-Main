-- Rollback validation is deliberately read-only. Schema rollback is performed
-- by restoring the pre-migration snapshot; academic history is never deleted by
-- a down migration.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database, now() AS checked_at,
       count(*) AS audit_rows FROM "AuditLog";

SELECT "organizationId", count(*) AS published_result_sets
FROM "ResultSet" WHERE status IN ('published', 'locked', 'archived')
GROUP BY "organizationId" ORDER BY "organizationId";

SELECT "organizationId", count(*) AS approved_student_assessments
FROM "StudentAssessment" WHERE "approvalStatus" = 'approved'
GROUP BY "organizationId" ORDER BY "organizationId";

COMMIT;
