import { Module } from '@nestjs/common';
import { AssessmentModule } from '../assessment/assessment.module';
import { LessonPlanningController } from './lesson-planning.controller';
import { LessonPlanningService } from './lesson-planning.service';
import { LmsExecutionController } from './lms-execution.controller';
import { LmsExecutionService } from './lms-execution.service';

@Module({
  // AssessmentModule supplies MarkingService — homework grades reach the spine
  // through its ledger, not by writing derived scores directly.
  imports: [AssessmentModule],
  controllers: [LessonPlanningController, LmsExecutionController],
  providers: [LessonPlanningService, LmsExecutionService],
  exports: [LessonPlanningService, LmsExecutionService],
})
export class LessonPlanningModule {}
