-- mod_lesson: per-pupil branching progress.
--
-- A lesson is a choose-your-path activity; each answer names the next page.
-- Without per-pupil state the branching has nowhere to live, so the activity
-- degrades to a flat list of pages and a pupil who leaves mid-way restarts.
--
-- `seen` records the ordered path actually taken, which is what makes a lesson
-- reviewable by a teacher rather than a bare pass/fail.

CREATE TABLE IF NOT EXISTS "ModLessonAttempt" (
    "id"               TEXT NOT NULL,
    "organizationId"   TEXT NOT NULL,
    "lessonId"         TEXT NOT NULL,
    "courseModuleId"   TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "currentPageId"    TEXT,
    "seen"             TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answers"          JSONB NOT NULL DEFAULT '{}',
    "correctCount"     INTEGER NOT NULL DEFAULT 0,
    "answeredCount"    INTEGER NOT NULL DEFAULT 0,
    "finishedAt"       TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModLessonAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ModLessonAttempt_lessonId_studentProfileId_key"
    ON "ModLessonAttempt" ("lessonId", "studentProfileId");
CREATE INDEX IF NOT EXISTS "ModLessonAttempt_organizationId_courseModuleId_idx"
    ON "ModLessonAttempt" ("organizationId", "courseModuleId");
