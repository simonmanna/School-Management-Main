import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../kernel/auth/decorators/public.decorator';
import { UPLOAD_OPTIONS } from '../../../kernel/files/upload-limits';
import { PublicAdmissionsService, PublicApplicationDto, PublicDocumentDto } from './public-admissions.service';

/**
 * Wave 16 — the school website's online application. No session: the school
 * is named by its organization code (the same preset code the portal logs in
 * with), and an applicant's later actions are authorized by the magic-link
 * token alone. Tight per-IP limits because these routes are open to anyone.
 */
@Controller('public/admissions')
export class PublicAdmissionsController {
  constructor(private readonly service: PublicAdmissionsService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':orgCode/options')
  options(@Param('orgCode') orgCode: string) {
    return this.service.options(orgCode);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @Post(':orgCode/applications')
  apply(@Param('orgCode') orgCode: string, @Body() dto: PublicApplicationDto) {
    return this.service.apply(orgCode, dto);
  }

  /** Attach a document to the token's application (PDF/JPG/PNG, 10 MB). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  upload(@Query('token') token: string, @Body() dto: PublicDocumentDto, @UploadedFile() file: any) {
    return this.service.uploadDocument(token, dto.type, file);
  }
}
