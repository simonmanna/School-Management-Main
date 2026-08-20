-- LMS Phase 1 relations (focused): adds FK constraints for the relations
-- introduced on the LMS Phase 1 tables. Indexes were created in 20260820_lms_phase1.
-- Safe to apply: only ADD CONSTRAINT (referential integrity), no data changes.

ALTER TABLE "CourseOfferingTeacher"
  ADD CONSTRAINT "CourseOfferingTeacher_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CourseOfferingTeacher_teacherPartnerId_fkey" FOREIGN KEY ("teacherPartnerId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LessonPlanActivity"
  ADD CONSTRAINT "LessonPlanActivity_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LessonPlanActivity_learningActivityId_fkey" FOREIGN KEY ("learningActivityId") REFERENCES "LearningActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LessonPlanResource"
  ADD CONSTRAINT "LessonPlanResource_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LessonPlanResource_learningResourceId_fkey" FOREIGN KEY ("learningResourceId") REFERENCES "LearningResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanAssessment"
  ADD CONSTRAINT "LessonPlanAssessment_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanDifferentiation"
  ADD CONSTRAINT "LessonPlanDifferentiation_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanReflection"
  ADD CONSTRAINT "LessonPlanReflection_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanReview"
  ADD CONSTRAINT "LessonPlanReview_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanRevision"
  ADD CONSTRAINT "LessonPlanRevision_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledLesson"
  ADD CONSTRAINT "ScheduledLesson_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ScheduledLesson_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Discussion"
  ADD CONSTRAINT "Discussion_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Discussion_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
