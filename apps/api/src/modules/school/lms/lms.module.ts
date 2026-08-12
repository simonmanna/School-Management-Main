import { Module } from '@nestjs/common';
import { AnnouncementService, HomeworkService, LearningResourceService, SubmissionService } from './lms.service';
import {
  AnnouncementController,
  HomeworkController,
  LearningResourceController,
  SubmissionController,
} from './lms.controller';

@Module({
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