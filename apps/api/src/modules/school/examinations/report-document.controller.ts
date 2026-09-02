import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ReportDocumentService } from './report-document.service';
import {
  GenerateReportDocumentsDto,
  PublishReportDocumentsDto,
  ReportDocumentQuery,
  VoidReportDocumentDto,
} from './report-document.dto';

/**
 * `/school/report-documents` — Phase 5 report provenance.
 *
 * Issuing a document and releasing it are different acts held by different
 * grants: a clerk may run the term's cards, a head teacher decides that families
 * see them.
 */
@Controller('school/report-documents')
export class ReportDocumentController {
  constructor(private readonly service: ReportDocumentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: ReportDocumentQuery) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post('generate')
  @RequirePermissions(PERMISSIONS.school.manageReportDocuments)
  generate(@Body() dto: GenerateReportDocumentsDto) {
    return this.service.generate(dto);
  }

  @Post('publish')
  @RequirePermissions(PERMISSIONS.school.publishReportDocuments)
  publish(@Body() dto: PublishReportDocumentsDto) {
    return this.service.publish(dto);
  }

  @Post(':id/void')
  @RequirePermissions(PERMISSIONS.school.publishReportDocuments)
  voidDocument(@Param('id') id: string, @Body() dto: VoidReportDocumentDto) {
    return this.service.void(id, dto);
  }
}
