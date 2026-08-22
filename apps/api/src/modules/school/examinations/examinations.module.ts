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
import { ReportCardSettingsService } from './report-card-settings.service';
import { MarksWorkspaceService } from './marks-workspace.service';
import {
  ExamController,
  ExamScheduleController,
  ExamTypeController,
  GradeEntryController,
  GradingScaleController,
  ReportCardController,
  ReportCardSettingsController,
  InvigilatorController,
  LearningOutcomeController,
  QuestionPaperController,
} from './examinations.controller';
import { ExamRegistrationController, ExamVenueController } from './exam-ops.controller';
import { MarksWorkspaceController } from './marks-workspace.controller';

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
    ReportCardSettingsController,
    MarksWorkspaceController,
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
    ReportCardSettingsService,
    MarksWorkspaceService,
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
    MarksWorkspaceService,
  ],
})
export class ExaminationsModule {}
