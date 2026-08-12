import { Module } from '@nestjs/common';
import {
  CurriculumService,
  LessonPlanService,
  TeacherAssignmentService,
  TimetableService,
} from './academics.service';
import {
  CurriculumController,
  LessonPlanController,
  TeacherAssignmentController,
  TimetableController,
} from './academics.controller';

@Module({
  controllers: [CurriculumController, LessonPlanController, TeacherAssignmentController, TimetableController],
  providers: [CurriculumService, LessonPlanService, TeacherAssignmentService, TimetableService],
  exports: [CurriculumService, LessonPlanService, TeacherAssignmentService, TimetableService],
})
export class AcademicsModule {}