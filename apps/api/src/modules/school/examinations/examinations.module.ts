import { Module } from '@nestjs/common';
import { AssessmentModule } from '../assessment/assessment.module';
import {
  ExamService,
  ExamScheduleService,
  ExamTypeService,
  GradeEntryService,
  GradingScaleService,
  ReportCardService,
} from './examinations.service';
import { ReportCardTemplateService } from './report-card-template.service';
import { ReportCardPdfService } from './report-card-pdf.service';
import { GradingService } from './grading.service';
import { ExamRegistrationService, ExamVenueService } from './exam-ops.service';
import {
  ExamController,
  ExamScheduleController,
  ExamTypeController,
  GradeEntryController,
  GradingScaleController,
  ReportCardController,
} from './examinations.controller';
import { ExamRegistrationController, ExamVenueController } from './exam-ops.controller';

@Module({
  imports: [AssessmentModule],
  controllers: [
    ExamTypeController,
    ExamController,
    ExamScheduleController,
    GradeEntryController,
    GradingScaleController,
    ReportCardController,
    ExamVenueController,
    ExamRegistrationController,
  ],
  providers: [
    ExamTypeService,
    ExamService,
    ExamScheduleService,
    GradeEntryService,
    GradingScaleService,
    GradingService,
    ReportCardService,
    ReportCardPdfService,
    ReportCardTemplateService,
    ExamVenueService,
    ExamRegistrationService,
  ],
  exports: [
    ExamTypeService,
    ExamService,
    ExamScheduleService,
    GradeEntryService,
    GradingScaleService,
    GradingService,
    ReportCardService,
    ReportCardPdfService,
    ReportCardTemplateService,
    ExamVenueService,
    ExamRegistrationService,
  ],
})
export class ExaminationsModule {}