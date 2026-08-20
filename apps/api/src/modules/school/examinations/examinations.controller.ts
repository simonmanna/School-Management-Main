import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  ExamService,
  ExamScheduleService,
  ExamTypeService,
  GradeEntryService,
  GradingScaleService,
  ReportCardService,
} from './examinations.service';
import { ReportCardSettingsService } from './report-card-settings.service';
import type { ReportCardSettingsDto } from './report-card-settings.service';
import { ReportCardPdfService } from './report-card-pdf.service';
import {
  RejectGradesDto,
  BulkGradeEntryDto,
  CreateExamDto,
  CreateExamScheduleDto,
  CreateExamTypeDto,
  CreateGradingScaleDto,
  GenerateReportCardDto,
  UpdateExamDto,
  UpdateExamScheduleDto,
  UpdateExamTypeDto,
  UpdateGradingScaleDto,
  UpdateReportCardCommentDto,
} from './dto.types';
import { InvigilatorService } from './invigilator.service';
import { CreateInvigilatorDto, UpdateInvigilatorDto, AssignInvigilatorDto } from './invigilator.dto';
import { LearningOutcomeService } from './outcomes.service';
import { CreateLearningOutcomeDto, UpdateLearningOutcomeDto, RecordOutcomeAchievementDto } from './outcomes.dto';
import { QuestionPaperService } from './question-paper.service';
import { CreateQuestionPaperDto, UpdateQuestionPaperDto } from './question-paper.dto';

@Controller('school/exam-types')
export class ExamTypeController {
  constructor(private readonly service: ExamTypeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateExamTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateExamTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/exams')
export class ExamController {
  constructor(private readonly service: ExamService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateExamDto) {
    return this.service.schedule(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateExamDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/exam-schedules')
export class ExamScheduleController {
  constructor(private readonly service: ExamScheduleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateExamScheduleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateExamScheduleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/grades')
export class GradeEntryController {
  constructor(
    private readonly grades: GradeEntryService,
    private readonly grading: GradingScaleService,
  ) {}

  @Post('bulk-upsert')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  bulkUpsert(@Body() dto: BulkGradeEntryDto) {
    return this.grades.bulkUpsert(dto);
  }

  @Post('submit/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  submit(@Param('examScheduleId') id: string) {
    return this.grades.submit(id);
  }

  @Post('approve/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.approveGrades)
  approve(@Param('examScheduleId') id: string) {
    return this.grades.approve(id);
  }

  @Post('reject/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.approveGrades)
  reject(@Param('examScheduleId') id: string, @Body() dto: RejectGradesDto) {
    return this.grades.reject(id, dto.reason);
  }

  @Get('by-class/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Param('examScheduleId') id: string) {
    return this.grades.byClass(id);
  }
}

@Controller('school/grading-scales')
export class GradingScaleController {
  constructor(private readonly service: GradingScaleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('default')
  @RequirePermissions(PERMISSIONS.school.read)
  default() {
    return this.service.default();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateGradingScaleDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateGradingScaleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/report-cards')
export class ReportCardController {
  constructor(
    private readonly service: ReportCardService,
    private readonly pdf: ReportCardPdfService,
  ) {}

  @Post('generate')
  @RequirePermissions(PERMISSIONS.school.computeResults)
  generate(@Body() dto: GenerateReportCardDto) {
    return this.service.generate(dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/unpublish')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  unpublish(@Param('id') id: string) {
    return this.service.unpublish(id);
  }

  /** P0-A: persist teacher/principal comments + competency levels for a card. */
  @Post('comment')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  updateComment(@Body() dto: UpdateReportCardCommentDto) {
    return this.service.updateComment(dto);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  async byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  /** Download a generated report card as a PDF. */
  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.school.read)
  async pdfDownload(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const buf = await this.pdf.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-card-${id}.pdf"`,
      'Content-Length': buf.length,
    });
    return new StreamableFile(buf);
  }
}

@Controller('school/report-card-settings')
export class ReportCardSettingsController {
  constructor(private readonly service: ReportCardSettingsService) {}

  /** GET the org's report card printable configuration (creates defaults if absent). */
  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  get() {
    return this.service.get();
  }

  /** PATCH the org's report card printable configuration. */
  @Patch()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Body() dto: ReportCardSettingsDto) {
    return this.service.update(dto);
  }
}

@Controller('school/invigilators')
export class InvigilatorController {
  constructor(private readonly service: InvigilatorService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateInvigilatorDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateInvigilatorDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** Assign an invigilator to an exam schedule (clash-checked). */
  @Post('assign')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  assign(@Body() dto: AssignInvigilatorDto) {
    return this.service.assign(dto);
  }

  @Delete('assign/:examScheduleId/:invigilatorId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  unassign(@Param('examScheduleId') examScheduleId: string, @Param('invigilatorId') invigilatorId: string) {
    return this.service.unassign(examScheduleId, invigilatorId);
  }

  @Get('by-schedule/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.read)
  bySchedule(@Param('examScheduleId') examScheduleId: string) {
    return this.service.bySchedule(examScheduleId);
  }
}

@Controller('school/learning-outcomes')
export class LearningOutcomeController {
  constructor(private readonly service: LearningOutcomeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  create(@Body() dto: CreateLearningOutcomeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  update(@Param('id') id: string, @Body() dto: UpdateLearningOutcomeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  /** P1-B: record a student's achievement against an outcome (idempotent). */
  @Post('achievement')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  recordAchievement(@Body() dto: RecordOutcomeAchievementDto) {
    return this.service.recordAchievement(dto);
  }

  @Get('achievements/student/:studentProfileId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  achievementsByStudentTerm(@Param('studentProfileId') studentProfileId: string, @Param('termId') termId: string) {
    return this.service.achievementsByStudentTerm(studentProfileId, termId);
  }

  @Get('achievements/subject/:subjectId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  achievementsBySubjectTerm(@Param('subjectId') subjectId: string, @Param('termId') termId: string) {
    return this.service.achievementsBySubjectTerm(subjectId, termId);
  }
}

@Controller('school/question-papers')
export class QuestionPaperController {
  constructor(private readonly service: QuestionPaperService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-schedule/:examScheduleId')
  @RequirePermissions(PERMISSIONS.school.read)
  bySchedule(@Param('examScheduleId') examScheduleId: string) {
    return this.service.bySchedule(examScheduleId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateQuestionPaperDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateQuestionPaperDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
