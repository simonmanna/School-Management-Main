import { Module } from '@nestjs/common';
import { LessonPlanningModule } from './lesson-planning.module';
import { AnnouncementService, HomeworkService, LearningResourceService, SubmissionService } from './lms.service';
import {
  AnnouncementController,
  HomeworkController,
  LearningResourceController,
  SubmissionController,
} from './lms.controller';

@Module({
  // LessonPlanningModule supplies LmsExecutionService — homework grading has a
  // single implementation, the one that reaches the assessment spine.
  imports: [LessonPlanningModule],
  controllers: [
    HomeworkController,
    SubmissionController,
    LearningResourceController,
    AnnouncementController,
  ],
  providers: [HomeworkService, SubmissionService, LearningResourceService, AnnouncementService],
  exports: [HomeworkService, SubmissionService, LearningResourceService, AnnouncementService],
})
export class LmsModule {}