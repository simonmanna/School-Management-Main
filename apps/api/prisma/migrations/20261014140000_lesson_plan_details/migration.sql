-- Ugandan lesson-plan format (academics review A18): theme/sub-theme,
-- competences, methods, lesson steps, duration and self-evaluation.
ALTER TABLE "LessonPlan" ADD COLUMN IF NOT EXISTS "details" JSONB NOT NULL DEFAULT '{}';

-- Guardian contact preference for results messages (academics review, decision 5).
ALTER TABLE "StudentGuardian" ADD COLUMN IF NOT EXISTS "receivesResults" BOOLEAN NOT NULL DEFAULT true;
