-- Expand–migrate. Legacy tables remain as read-only provenance; nothing is deleted.
ALTER TYPE "AssessmentKind" ADD VALUE IF NOT EXISTS 'assignment';
ALTER TYPE "AssessmentKind" ADD VALUE IF NOT EXISTS 'quiz';
ALTER TYPE "AssessmentKind" ADD VALUE IF NOT EXISTS 'observation';
ALTER TYPE "AssessmentKind" ADD VALUE IF NOT EXISTS 'activity_of_integration';
ALTER TYPE "ParticipationStatus" ADD VALUE IF NOT EXISTS 'missing';
ALTER TYPE "ParticipationStatus" ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE "ParticipationStatus" ADD VALUE IF NOT EXISTS 'not_enrolled';
ALTER TABLE "AssessmentPolicy" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "supersedesId" TEXT;
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "courseOfferingId" TEXT,
  ADD COLUMN IF NOT EXISTS "rosterId" TEXT, ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "openAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "closeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "feedbackReleaseAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "marksReleaseAt" TIMESTAMP(3);
ALTER TABLE "StudentAssessment" ADD COLUMN IF NOT EXISTS "feedback" TEXT;
-- Competency, club and school-wide offerings need not invent a subject/class.
ALTER TABLE "Assessment" ALTER COLUMN "subjectId" DROP NOT NULL, ALTER COLUMN "classId" DROP NOT NULL;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "legacyHomeworkId" TEXT;
ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "legacyHomeworkSubmissionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Assignment_legacyHomeworkId_key" ON "Assignment"("legacyHomeworkId");
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentSubmission_legacyHomeworkSubmissionId_key" ON "AssignmentSubmission"("legacyHomeworkSubmissionId");
CREATE INDEX IF NOT EXISTS "Assessment_courseOfferingId_idx" ON "Assessment"("courseOfferingId");
CREATE INDEX IF NOT EXISTS "Assessment_rosterId_idx" ON "Assessment"("rosterId");
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "AcademicRoster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AssessmentOutcome" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "assessmentId" TEXT NOT NULL,
  "learningOutcomeId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssessmentOutcome_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssessmentOutcome_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssessmentOutcome_assessmentId_learningOutcomeId_key" ON "AssessmentOutcome"("assessmentId", "learningOutcomeId");
CREATE INDEX "AssessmentOutcome_organizationId_idx" ON "AssessmentOutcome"("organizationId");
CREATE INDEX "AssessmentOutcome_learningOutcomeId_idx" ON "AssessmentOutcome"("learningOutcomeId");
ALTER TABLE "AssessmentOutcome" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AssessmentOutcome" USING ("organizationId" = current_setting('app.org_id', true));

-- Never guess between team/group offerings: only an exact, unique match is adopted.
UPDATE "Assessment" a SET "courseOfferingId" = (
  SELECT min(co.id) FROM "CourseOffering" co WHERE co."organizationId" = a."organizationId"
    AND co."termId" = a."termId" AND co."classId" = a."classId" AND co."subjectId" = a."subjectId"
    AND co."sectionId" IS NOT DISTINCT FROM a."sectionId" AND co."deletedAt" IS NULL HAVING count(*) = 1
) WHERE a."courseOfferingId" IS NULL;
-- Only an existing explicit assignment binding proves which historical roster was used.
UPDATE "Assessment" a SET "rosterId" = r.id FROM "Assignment" x JOIN "AcademicRoster" r ON r.id = x."rosterId"
WHERE x."assessmentId" = a.id AND r."organizationId" = a."organizationId" AND r."frozenAt" IS NOT NULL;

INSERT INTO "Assignment" ("id", "organizationId", "assessmentId", "legacyHomeworkId", "instructions", "allowLate", "latePenaltyPercent", "maxAttempts", "gradingMode", "attachments", "version", "createdAt", "updatedAt")
SELECT 'phase4-assignment-' || h.id, h."organizationId", h."assessmentId", h.id, h."description", false, 0, 1,
  'points'::"AssignmentGradingMode", h."attachments", 0, h."createdAt", h."updatedAt"
FROM "HomeworkAssignment" h JOIN "Assessment" a ON a.id = h."assessmentId" AND a."organizationId" = h."organizationId"
ON CONFLICT ("assessmentId") DO UPDATE SET "legacyHomeworkId" = EXCLUDED."legacyHomeworkId";

-- Expand learner evidence only where student + assessment mappings are proven.
INSERT INTO "StudentAssessment" ("id", "organizationId", "assessmentId", "studentProfileId", "classId", "sectionId", "termId", "maxScore", "status", "feedback", "createdAt", "updatedAt")
SELECT 'phase4-sa-' || s.id, s."organizationId", a.id, s."studentProfileId", a."classId", a."sectionId", a."termId", a."maxScore",
  CASE WHEN s."submittedAt" IS NOT NULL THEN 'submitted'::"StudentAssessmentStatus" ELSE 'assigned'::"StudentAssessmentStatus" END,
  s.feedback, COALESCE(s."submittedAt", a."createdAt"), CURRENT_TIMESTAMP
FROM "HomeworkSubmission" s JOIN "HomeworkAssignment" h ON h.id = s."assignmentId" AND h."organizationId" = s."organizationId"
JOIN "Assessment" a ON a.id = h."assessmentId" AND a."organizationId" = s."organizationId"
JOIN "StudentProfile" p ON p.id = s."studentProfileId" AND p."organizationId" = s."organizationId"
ON CONFLICT ("assessmentId", "studentProfileId") DO NOTHING;

INSERT INTO "AssignmentSubmission" ("id", "organizationId", "assignmentId", "studentAssessmentId", "legacyHomeworkSubmissionId", "attemptNo", "submittedAt", "isLate", "content", "attachments", "rawScore", "version", "createdAt", "updatedAt")
SELECT 'phase4-submission-' || s.id, s."organizationId", x.id, sa.id, s.id, 1, s."submittedAt", s.status = 'late', s.content, s.attachments, s.score, 0,
  COALESCE(s."submittedAt", x."createdAt"), CURRENT_TIMESTAMP
FROM "HomeworkSubmission" s JOIN "Assignment" x ON x."legacyHomeworkId" = s."assignmentId" AND x."organizationId" = s."organizationId"
JOIN "StudentAssessment" sa ON sa."assessmentId" = x."assessmentId" AND sa."studentProfileId" = s."studentProfileId" AND sa."organizationId" = s."organizationId"
ON CONFLICT ("assignmentId", "studentAssessmentId", "attemptNo") DO NOTHING;

-- Recover an unmapped historic score into the canonical ledger, without overwriting a canonical mark.
INSERT INTO "MarkEntry" ("id", "organizationId", "studentAssessmentId", "markerId", "round", "score", "comment", "enteredAt")
SELECT 'phase4-mark-' || s.id, s."organizationId", sa.id, s."gradedById", 'first'::"MarkRound", s.score, s.feedback, COALESCE(s."gradedAt", CURRENT_TIMESTAMP)
FROM "HomeworkSubmission" s JOIN "Assignment" x ON x."legacyHomeworkId" = s."assignmentId" AND x."organizationId" = s."organizationId"
JOIN "StudentAssessment" sa ON sa."assessmentId" = x."assessmentId" AND sa."studentProfileId" = s."studentProfileId" AND sa."organizationId" = s."organizationId"
WHERE s.score IS NOT NULL AND s.score >= 0 AND s.score <= sa."maxScore" AND sa."effectiveScore" IS NULL
ON CONFLICT ("studentAssessmentId", "round") DO NOTHING;
UPDATE "StudentAssessment" sa SET "originalScore" = m.score, "effectiveScore" = m.score,
  percentage = CASE WHEN sa."maxScore" > 0 THEN m.score / sa."maxScore" * 100 ELSE NULL END,
  "enteredById" = m."markerId", "enteredAt" = m."enteredAt", feedback = COALESCE(sa.feedback, m.comment)
FROM "MarkEntry" m WHERE m."studentAssessmentId" = sa.id AND m.id LIKE 'phase4-mark-%' AND sa."effectiveScore" IS NULL;

-- Preserve historically visible, approved marks as an explicit legacy release.
UPDATE "Assessment" a SET "marksReleaseAt" = a."updatedAt", "feedbackReleaseAt" = a."updatedAt"
WHERE NOT a."hiddenFromStudents" AND EXISTS (SELECT 1 FROM "StudentAssessment" sa WHERE sa."assessmentId" = a.id AND sa."approvalStatus" = 'approved');

INSERT INTO "AcademicMigrationException" ("id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload")
SELECT 'phase4-context-' || a.id, a."organizationId", '20260906000000_phase4_unified_assessment', 'Assessment', a.id,
  'COURSE_OR_FROZEN_ROSTER_BINDING_REQUIRED', jsonb_build_object('courseOfferingId', a."courseOfferingId", 'rosterId', a."rosterId")
FROM "Assessment" a WHERE a."courseOfferingId" IS NULL OR a."rosterId" IS NULL ON CONFLICT (id) DO NOTHING;
INSERT INTO "AcademicMigrationException" ("id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload")
SELECT 'phase4-homework-' || h.id, h."organizationId", '20260906000000_phase4_unified_assessment', 'HomeworkAssignment', h.id,
  'HOMEWORK_ASSESSMENT_MAPPING_REQUIRED', '{}'::jsonb FROM "HomeworkAssignment" h
WHERE NOT EXISTS (SELECT 1 FROM "Assignment" x WHERE x."legacyHomeworkId" = h.id) ON CONFLICT (id) DO NOTHING;
INSERT INTO "AcademicMigrationException" ("id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload")
SELECT 'phase4-submission-exception-' || s.id, s."organizationId", '20260906000000_phase4_unified_assessment', 'HomeworkSubmission', s.id,
  'SUBMISSION_MAPPING_OR_SCORE_RECONCILIATION_REQUIRED', jsonb_build_object('score', s.score)
FROM "HomeworkSubmission" s LEFT JOIN "AssignmentSubmission" ns ON ns."legacyHomeworkSubmissionId" = s.id
LEFT JOIN "StudentAssessment" sa ON sa.id = ns."studentAssessmentId"
WHERE ns.id IS NULL OR (s.score IS NOT NULL AND sa."effectiveScore" IS DISTINCT FROM s.score) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION prevent_frozen_roster_member_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "AcademicRoster" WHERE id = OLD."rosterId" AND "frozenAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Frozen academic roster membership cannot be changed';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "AcademicRoster" WHERE id = NEW."rosterId" AND "frozenAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Frozen academic roster membership cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AcademicRosterMember_frozen_guard" ON "AcademicRosterMember";
CREATE TRIGGER "AcademicRosterMember_frozen_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AcademicRosterMember" FOR EACH ROW EXECUTE FUNCTION prevent_frozen_roster_member_change();

-- Preserve the exact rules already used by published historical assessments.
UPDATE "AssessmentPolicy" p SET "publishedAt" = p."updatedAt"
WHERE p."publishedAt" IS NULL AND EXISTS (
  SELECT 1 FROM "AssessmentComponent" c JOIN "Assessment" a ON a."componentId" = c.id
  WHERE c."policyId" = p.id AND a.status NOT IN ('draft', 'scheduled')
);

CREATE OR REPLACE FUNCTION phase4_policy_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'AssessmentPolicy' THEN
    IF OLD."publishedAt" IS NOT NULL THEN RAISE EXCEPTION 'Published policy revisions are immutable'; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM id FROM "AssessmentPolicy" WHERE id = OLD."policyId" FOR UPDATE; END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM id FROM "AssessmentPolicy" WHERE id = NEW."policyId" FOR UPDATE; END IF;
    IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "AssessmentPolicy" WHERE id = OLD."policyId" AND "publishedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Published policy components are immutable'; END IF;
    IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM "AssessmentPolicy" WHERE id = NEW."policyId" AND "publishedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Published policy components are immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "AssessmentPolicy_published_guard" BEFORE UPDATE OR DELETE ON "AssessmentPolicy" FOR EACH ROW EXECUTE FUNCTION phase4_policy_immutable();
CREATE TRIGGER "AssessmentComponent_published_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentComponent" FOR EACH ROW EXECUTE FUNCTION phase4_policy_immutable();
