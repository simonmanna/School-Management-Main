import { Module } from '@nestjs/common';
import { LessonPlanningController } from './lesson-planning.controller';
import { LessonPlanningService } from './lesson-planning.service';
import { LmsExecutionController } from './lms-execution.controller';
import { LmsExecutionService } from './lms-execution.service';

@Module({
  controllers: [LessonPlanningController, LmsExecutionController],
  providers: [LessonPlanningService, LmsExecutionService],
  exports: [LessonPlanningService, LmsExecutionService],
})
export class LessonPlanningModule {}
