import { Module } from '@nestjs/common';
import { LessonPlanningModule } from './lesson-planning.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { AnnouncementService, HomeworkService, LearningResourceService, SubmissionService } from './lms.service';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';
import {
  AnnouncementController,
  HomeworkController,
  LearningResourceController,
  SubmissionController,
} from './lms.controller';

@Module({
  // LessonPlanningModule supplies LmsExecutionService — homework grading has a
  // single implementation, the one that reaches the assessment spine.
  // AssessmentModule supplies AssessmentMintService: homework IS an assessment,
  // and its gradebook column is minted when the work is set.
  // PlacementLookupModule: homework rosters read placement history (ADR-027).
  imports: [LessonPlanningModule, AssessmentModule, PlacementLookupModule],
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