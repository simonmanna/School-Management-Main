import { Body, Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Public } from '../../../kernel/auth/decorators/public.decorator';
import { CertificateService, ExternalExamResultService, TranscriptService } from './cert.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { IssueCertificateDto, IssueLeavingCertificateDto, RecordExternalResultDto, RevokeCertificateDto } from './cert.dto';

@Controller('school/transcripts')
export class TranscriptController {
  constructor(private readonly service: TranscriptService) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Post('build/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.issueCertificates)
  build(@Param('studentProfileId') id: string) {
    return this.service.build(id);
  }
}

@Controller('school/external-results')
export class ExternalExamResultController {
  constructor(private readonly service: ExternalExamResultService) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  record(@Body() dto: RecordExternalResultDto) {
    return this.service.record(dto);
  }
}

@Controller('school/certificates')
export class CertificateController {
  constructor(
    private readonly service: CertificateService,
    private readonly pdf: CertificatePdfService,
  ) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Post('issue')
  @RequirePermissions(PERMISSIONS.school.issueCertificates)
  issue(@Body() dto: IssueCertificateDto) {
    return this.service.issue(dto);
  }

  /** Wave 16: leaving (transfer) certificate, snapshotted from the record. */
  @Post('leaving')
  @RequirePermissions(PERMISSIONS.school.issueCertificates)
  issueLeaving(@Body() dto: IssueLeavingCertificateDto) {
    return this.service.issueLeaving(dto);
  }

  /** Printable copy. Office-only: the id alone would otherwise reach any pupil's record. */
  @Get(':id/pdf')
  @RequirePermissions(PERMISSIONS.school.issueCertificates)
  async printable(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { filename, pdf } = await this.pdf.generatePdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Content-Length': pdf.length });
    return new StreamableFile(pdf);
  }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.school.revokeCertificates)
  revoke(@Param('id') id: string, @Body() dto: RevokeCertificateDto) {
    return this.service.revoke(id, dto.reason, dto.void ?? false);
  }
}

/**
 * PUBLIC certificate verification — no auth, no tenant. Returns only holder
 * name, type, status and issue date. (Should sit behind the global rate limiter.)
 */
@Controller('verify/certificate')
export class CertificateVerifyController {
  constructor(private readonly service: CertificateService) {}

  @Public()
  @Get(':code')
  verify(@Param('code') code: string) {
    return this.service.verify(code);
  }
}
