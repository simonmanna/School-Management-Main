import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { LmsFileService, type LmsFileArea } from './lms-file.service';

/**
 * LMS file endpoints (L2.1).
 *
 * Deliberately thin: the kernel already handles the upload itself
 * (`POST /files/upload`). These routes attach an uploaded file to a course area
 * and issue reads, both of which need the course-level check the kernel signer
 * does not perform.
 */
@Controller('school/lms/files')
export class LmsFileController {
  constructor(private readonly files: LmsFileService) {}

  @Post('attach')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  attach(@Body() dto: {
    fileId: string; courseOfferingId: string; area: LmsFileArea; itemId: string; studentProfileId?: string;
  }) {
    return this.files.attach(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  list(
    @Query('courseOfferingId') courseOfferingId: string,
    @Query('area') area: LmsFileArea,
    @Query('itemId') itemId: string,
  ) {
    return this.files.list(courseOfferingId, area, itemId);
  }

  /** Short-lived signed URL, issued only after the course + area check. */
  @Post(':id/url')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  url(@Param('id') id: string) {
    return this.files.signDownload(id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  remove(@Param('id') id: string) {
    return this.files.remove(id);
  }
}
