import { Module } from '@nestjs/common';
import { CampusService } from './campus.service';
import { CampusController } from './campus.controller';
import { AcademicYearService, TermService } from './academic-year.service';
import { AcademicYearController, TermController } from './academic-year.controller';
import { DepartmentService } from './department.service';
import { DepartmentController } from './department.controller';
import { GradeLevelService } from './grade-level.service';
import { GradeLevelController } from './grade-level.controller';
import { SchoolClassService, SectionService } from './class.service';
import { SchoolClassController, SectionController } from './class.controller';
import { SubjectService } from './subject.service';
import { SubjectController } from './subject.controller';
import { CalendarService, PeriodService } from './period-calendar.service';
import { CalendarController, PeriodController } from './period-calendar.controller';

/**
 * Foundation sprint — school-level master data.
 * No state machines; everything is CRUD over org-scoped tables.
 */
@Module({
  controllers: [
    CampusController,
    AcademicYearController,
    TermController,
    DepartmentController,
    GradeLevelController,
    SchoolClassController,
    SectionController,
    SubjectController,
    PeriodController,
    CalendarController,
  ],
  providers: [
    CampusService,
    AcademicYearService,
    TermService,
    DepartmentService,
    GradeLevelService,
    SchoolClassService,
    SectionService,
    SubjectService,
    PeriodService,
    CalendarService,
  ],
  exports: [
    CampusService,
    AcademicYearService,
    TermService,
    DepartmentService,
    GradeLevelService,
    SchoolClassService,
    SectionService,
    SubjectService,
    PeriodService,
    CalendarService,
  ],
})
export class FoundationModule {}