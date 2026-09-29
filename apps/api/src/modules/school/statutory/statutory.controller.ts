import { Body, Controller, Get, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CandidateReferenceService } from './candidate-reference.service';
import { UnebCaService } from './uneb-ca.service';
import { StatutoryExportService } from './statutory-export.service';
import {
  AssignCandidateNumbersDto,
  CreateExportTemplateDto,
  ImportIndexNumbersDto,
  MarkSubmittedDto,
  RunExportDto,
  UpdateExportTemplateDto,
  UpsertExamReferenceDto,
  WithdrawReferenceDto,
} from './statutory.dto';

/**
 * `/school/statutory` — the exam office's national-submission desk (Phase 6).
 *
 * Reads sit on `school:statutory:read` rather than `school:read`: a candidate
 * register is a list of children with their dates of birth and national
 * identifiers, which is a narrower audience than the class list. Producing a
 * file and designing the layout are separate grants again, because the file
 * leaves the building and cannot be recalled.
 */
@Controller('school/statutory')
export class StatutoryController {
  constructor(
    private readonly references: CandidateReferenceService,
    private readonly ca: UnebCaService,
    private readonly exports: StatutoryExportService,
  ) {}

  // ── candidate references ────────────────────────────────────────────────
  @Get('candidates')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  listReferences(
    @Query('level') level?: string,
    @Query('registrationYear') registrationYear?: string,
    @Query('status') status?: string,
    @Query('classId') classId?: string,
    @Query('search') search?: string,
  ) {
    return this.references.list({
      level,
      registrationYear: registrationYear ? Number(registrationYear) : undefined,
      status,
      classId,
      search,
    });
  }

  @Get('candidates/missing')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  missingReferences(@Query('level') level: string, @Query('registrationYear') registrationYear: string) {
    return this.references.missing(level, Number(registrationYear));
  }

  @Post('candidates')
  @RequirePermissions(PERMISSIONS.school.manageCandidateReferences)
  upsertReference(@Body() dto: UpsertExamReferenceDto) {
    return this.references.upsert(dto);
  }

  @Post('candidates/assign-numbers')
  @RequirePermissions(PERMISSIONS.school.manageCandidateReferences)
  assignNumbers(@Body() dto: AssignCandidateNumbersDto) {
    return this.references.assignNumbers(dto);
  }

  @Post('candidates/import-index-numbers')
  @RequirePermissions(PERMISSIONS.school.manageCandidateReferences)
  importIndexNumbers(@Body() dto: ImportIndexNumbersDto) {
    return this.references.importIndexNumbers(dto);
  }

  @Post('candidates/:id/withdraw')
  @RequirePermissions(PERMISSIONS.school.manageCandidateReferences)
  withdrawReference(@Param('id') id: string, @Body() dto: WithdrawReferenceDto) {
    return this.references.withdraw(id, dto.reason);
  }

  @Get('candidates/reconcile/:examId')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  reconcile(@Param('examId') examId: string) {
    return this.references.reconcileWithSnapshot(examId);
  }

  // ── UNEB continuous assessment ──────────────────────────────────────────
  // The readiness board reads every candidate's mark ledger for the term. It is
  // the most expensive read in this controller and the one a dashboard would be
  // tempted to poll.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('uneb-ca/readiness')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  caReadiness(
    @Query('termId') termId: string,
    @Query('level') level: string,
    @Query('registrationYear') registrationYear?: string,
    @Query('classIds') classIds?: string,
  ) {
    return this.ca.readiness({
      termId,
      level,
      registrationYear: registrationYear ? Number(registrationYear) : undefined,
      classIds: classIds ? classIds.split(',').filter(Boolean) : undefined,
    });
  }

  // ── export templates ────────────────────────────────────────────────────
  @Get('datasets')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  datasets() {
    return this.exports.datasets();
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  listTemplates(@Query('scope') scope?: string) {
    return this.exports.listTemplates(scope);
  }

  @Post('templates/seed-defaults')
  @RequirePermissions(PERMISSIONS.school.manageStatutoryTemplates)
  seedDefaults() {
    return this.exports.seedDefaults();
  }

  @Post('templates')
  @RequirePermissions(PERMISSIONS.school.manageStatutoryTemplates)
  createTemplate(@Body() dto: CreateExportTemplateDto) {
    return this.exports.createTemplate(dto);
  }

  @Put('templates/:id')
  @RequirePermissions(PERMISSIONS.school.manageStatutoryTemplates)
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateExportTemplateDto) {
    return this.exports.updateTemplate(id, dto);
  }

  // ── running exports ─────────────────────────────────────────────────────
  @Post('exports/preview')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  preview(@Body() dto: RunExportDto) {
    return this.exports.preview(dto);
  }

  // Phase 7. A run recomputes readiness across a whole cohort and produces a
  // file that leaves the building; both the cost and the export rate deserve a
  // tighter bound than the global tier.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('exports/run')
  @RequirePermissions(PERMISSIONS.school.runStatutoryExports)
  async run(@Body() dto: RunExportDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.exports.run(dto);
    // The run id and checksum travel in headers so a browser download and an
    // API caller both end up holding the provenance, not just the bytes.
    res.setHeader('X-Export-Run-Id', result.runId);
    res.setHeader('X-Export-Checksum', result.checksum);
    // The JSON response carries the CSV text; the workbook is served by /download.
    const { xlsx: _xlsx, ...json } = result;
    return json;
  }

  @Get('exports/runs')
  @RequirePermissions(PERMISSIONS.school.readStatutory)
  listRuns(@Query('scope') scope?: string) {
    return this.exports.listRuns(scope);
  }

  @Post('exports/runs/:id/submitted')
  @RequirePermissions(PERMISSIONS.school.runStatutoryExports)
  markSubmitted(@Param('id') id: string, @Body() dto: MarkSubmittedDto) {
    return this.exports.markSubmitted(id, dto);
  }

  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('exports/download')
  @RequirePermissions(PERMISSIONS.school.runStatutoryExports)
  async download(@Body() dto: RunExportDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.exports.run(dto);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Export-Run-Id', result.runId);
    res.setHeader('X-Export-Checksum', result.checksum);
    if (result.xlsx) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return new StreamableFile(result.xlsx);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return result.content;
  }
}
