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
import { ExamOperationsService } from './exam-operations.service';
import { ExamSessionService } from './exam-session.service';
import { ExamMarkingService } from './exam-marking.service';
import { QuestionPaperCustodyService } from './question-paper-custody.service';
import { MarkerDirectoryService } from './marker-directory.service';
import { ReportDocumentService } from './report-document.service';
import { ExamOperationsController } from './exam-operations.controller';
import { ReportDocumentController } from './report-document.controller';
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
    ExamOperationsController,
    ReportDocumentController,
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
    ExamOperationsService,
    ExamSessionService,
    ExamMarkingService,
    QuestionPaperCustodyService,
    MarkerDirectoryService,
    ReportDocumentService,
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
    ExamOperationsService,
    ExamSessionService,
    ExamMarkingService,
    QuestionPaperCustodyService,
    ReportDocumentService,
  ],
})
export class ExaminationsModule {}
