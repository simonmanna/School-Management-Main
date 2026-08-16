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
import { InvigilatorService } from './invigilator.service';
import { LearningOutcomeService } from './outcomes.service';
import { QuestionPaperService } from './question-paper.service';
import {
  ExamController,
  ExamScheduleController,
  ExamTypeController,
  GradeEntryController,
  GradingScaleController,
  ReportCardController,
  InvigilatorController,
  LearningOutcomeController,
  QuestionPaperController,
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
    InvigilatorController,
    LearningOutcomeController,
    QuestionPaperController,
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
    InvigilatorService,
    LearningOutcomeService,
    QuestionPaperService,
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
    InvigilatorService,
    LearningOutcomeService,
    QuestionPaperService,
  ],
})
export class ExaminationsModule {}
