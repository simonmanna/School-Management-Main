import { Module } from '@nestjs/common';
import {
  CurriculumService,
  LessonPlanService,
  TeacherAssignmentService,
  TimetableService,
} from './academics.service';
import {
  CompetencyService,
  TopicService,
  UnitService,
  LearningObjectiveService,
} from './curriculum-content.service';
import {
  CurriculumController,
  LessonPlanController,
  TeacherAssignmentController,
  TimetableController,
} from './academics.controller';
import {
  CompetencyController,
  TopicController,
  UnitController,
  LearningObjectiveController,
} from './curriculum-content.controller';

@Module({
  controllers: [
    CurriculumController,
    LessonPlanController,
    TeacherAssignmentController,
    TimetableController,
    CompetencyController,
    TopicController,
    UnitController,
    LearningObjectiveController,
  ],
  providers: [
    CurriculumService,
    LessonPlanService,
    TeacherAssignmentService,
    TimetableService,
    CompetencyService,
    TopicService,
    UnitService,
    LearningObjectiveService,
  ],
  exports: [
    CurriculumService,
    LessonPlanService,
    TeacherAssignmentService,
    TimetableService,
    CompetencyService,
    TopicService,
    UnitService,
    LearningObjectiveService,
  ],
})
export class AcademicsModule {}