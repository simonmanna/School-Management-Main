import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Public } from '../../../kernel/auth/decorators/public.decorator';
import { CertificateService, ExternalExamResultService, TranscriptService } from './cert.service';
import { IssueCertificateDto, RecordExternalResultDto, RevokeCertificateDto } from './cert.dto';

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
  constructor(private readonly service: CertificateService) {}

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
