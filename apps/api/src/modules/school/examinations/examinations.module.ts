import { Module } from '@nestjs/common';
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
import {
  ExamController,
  ExamScheduleController,
  ExamTypeController,
  GradeEntryController,
  GradingScaleController,
  ReportCardController,
} from './examinations.controller';

@Module({
  controllers: [
    ExamTypeController,
    ExamController,
    ExamScheduleController,
    GradeEntryController,
    GradingScaleController,
    ReportCardController,
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
  ],
})
export class ExaminationsModule {}