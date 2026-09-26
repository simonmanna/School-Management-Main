-- F04: a recomputation is a draft beside the released set, never a replacement
-- of it. At most one released and one pending set per (org, term, scope).
DROP INDEX IF EXISTS "ResultSet_one_live_per_scope";
CREATE UNIQUE INDEX "ResultSet_one_released_per_scope" ON "ResultSet"("organizationId", "termId", "scopeType", "scopeId")
    WHERE "status" IN ('published', 'locked') AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "ResultSet_one_pending_per_scope" ON "ResultSet"("organizationId", "termId", "scopeType", "scopeId")
    WHERE "status" IN ('draft', 'computing', 'computed', 'approved') AND "deletedAt" IS NULL;

-- F03 correction: adapter-fed evidence (homework, quiz, LMS) keeps counting
-- through its unique same-kind component; only teacher-created component-less
-- work was described as formative.
UPDATE "Assessment" SET "contribution" = 'summative'
 WHERE "componentId" IS NULL AND "sourceType" IN ('homework', 'quiz', 'lms_activity');
