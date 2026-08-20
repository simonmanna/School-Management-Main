import { Module } from '@nestjs/common';
import { LessonPlanningController } from './lesson-planning.controller';
import { LessonPlanningService } from './lesson-planning.service';

@Module({
  controllers: [LessonPlanningController],
  providers: [LessonPlanningService],
  exports: [LessonPlanningService],
})
export class LessonPlanningModule {}
