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
import { SubjectCategoryService } from './subject-category.service';
import { SubjectCategoryController } from './subject-category.controller';
import { StreamService } from './stream.service';
import { StreamController } from './stream.controller';
import { CalendarService, PeriodService } from './period-calendar.service';
import { CalendarController, PeriodController } from './period-calendar.controller';
import { CalendarEventService } from './calendar-event.service';
import { CalendarEventController } from './calendar-event.controller';
import { SchoolPolicyService } from './school-policy.service';
import { SchoolPolicyController } from './school-policy.controller';
import { CustomFieldService } from './custom-field.service';
import { CustomFieldController } from './custom-field.controller';

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
    SubjectCategoryController,
    StreamController,
    PeriodController,
    CalendarController,
    CalendarEventController,
    SchoolPolicyController,
    CustomFieldController,
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
    SubjectCategoryService,
    StreamService,
    PeriodService,
    CalendarService,
    CalendarEventService,
    SchoolPolicyService,
    CustomFieldService,
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
    SubjectCategoryService,
    StreamService,
    PeriodService,
    CalendarService,
    CalendarEventService,
    SchoolPolicyService,
    CustomFieldService,
  ],
})
export class FoundationModule {}