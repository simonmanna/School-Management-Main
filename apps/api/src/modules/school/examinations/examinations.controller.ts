import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
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
import { ReportCardPdfService } from './report-card-pdf.service';
import type {
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
} from './dto.types';

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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  create(@Body() dto: CreateExamTypeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  update(@Param('id') id: string, @Body() dto: UpdateExamTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.enterGrades)
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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  create(@Body() dto: CreateExamDto) {
    return this.service.schedule(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  update(@Param('id') id: string, @Body() dto: UpdateExamDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  close(@Param('id') id: string) {
    return this.service.close(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.enterGrades)
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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  create(@Body() dto: CreateExamScheduleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  update(@Param('id') id: string, @Body() dto: UpdateExamScheduleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.enterGrades)
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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  approve(@Param('examScheduleId') id: string) {
    return this.grades.approve(id);
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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  create(@Body() dto: CreateGradingScaleDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  update(@Param('id') id: string, @Body() dto: UpdateGradingScaleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.enterGrades)
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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  generate(@Body() dto: GenerateReportCardDto) {
    return this.service.generate(dto);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  async byStudent(@Param('studentProfileId') id: string) {
    const cards = await (this.service as any).prisma.client.reportCard.findMany({
      where: { studentProfileId: id },
      orderBy: { generatedAt: 'desc' },
    });
    return cards;
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