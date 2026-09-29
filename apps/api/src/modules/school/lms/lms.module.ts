import { Module } from '@nestjs/common';
import { AnnouncementService, LearningResourceService } from './lms.service';
import {
  AnnouncementController,
  HomeworkController,
  LearningResourceController,
  SubmissionController,
} from './lms.controller';

@Module({
  // Legacy homework is retired (audit 2026-09-29 A01); its controllers answer
  // 410 and need no services.
  controllers: [
    HomeworkController,
    SubmissionController,
    LearningResourceController,
    AnnouncementController,
  ],
  providers: [LearningResourceService, AnnouncementService],
  exports: [LearningResourceService, AnnouncementService],
})
export class LmsModule {}