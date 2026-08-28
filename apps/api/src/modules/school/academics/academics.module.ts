import { Module } from '@nestjs/common';
import {
  CurriculumService,
  TeacherAssignmentService,
  TimetableService,
} from './academics.service';
import { TimetableAdvancedService } from './timetable-advanced.service';
import { TeacherCoverService } from './teacher-cover.service';
import {
  CompetencyService,
  TopicService,
  UnitService,
  LearningObjectiveService,
} from './curriculum-content.service';
import {
  CurriculumController,
  TeacherAssignmentController,
  TimetableController,
} from './academics.controller';
import { TimetableAdvancedController } from './timetable-advanced.controller';
import {
  CompetencyController,
  TopicController,
  UnitController,
  LearningObjectiveController,
} from './curriculum-content.controller';

@Module({
  controllers: [
    CurriculumController,
    TeacherAssignmentController,
    TimetableController,
    TimetableAdvancedController,
    CompetencyController,
    TopicController,
    UnitController,
    LearningObjectiveController,
  ],
  providers: [
    CurriculumService,
    TeacherAssignmentService,
    TimetableService,
    TimetableAdvancedService,
    TeacherCoverService,
    CompetencyService,
    TopicService,
    UnitService,
    LearningObjectiveService,
  ],
  exports: [
    CurriculumService,
    TeacherAssignmentService,
    TimetableService,
    TimetableAdvancedService,
    TeacherCoverService,
    CompetencyService,
    TopicService,
    UnitService,
    LearningObjectiveService,
  ],
})
export class AcademicsModule {}