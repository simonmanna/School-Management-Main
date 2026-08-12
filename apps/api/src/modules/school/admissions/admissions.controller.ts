import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AdmissionsService } from './admissions.service';
import type { AddExamScoreDto, CreateApplicationDto, EnrollApplicationDto, UpdateApplicationDto } from './dto.types';

@Controller('school/admissions')
export class AdmissionsController {
  constructor(private readonly admissions: AdmissionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.admissions.list(q);
  }

  @Get('by-status/:status')
  @RequirePermissions(PERMISSIONS.school.read)
  byStatus(@Param('status') status: string) {
    return this.admissions.byStatus(status);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.admissions.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  create(@Body() dto: CreateApplicationDto) {
    return this.admissions.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.admissions.update(id, dto);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  review(@Param('id') id: string, @Body('action') action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw', @Body('notes') notes?: string) {
    return this.admissions.review(id, action, notes);
  }

  @Post(':id/exam-score')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  addExamScore(@Param('id') _id: string, @Body() dto: AddExamScoreDto) {
    return this.admissions.addExamScore(dto);
  }

  @Post(':id/documents')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  addDocument(@Param('id') id: string, @Body('type') type: string, @Body('fileId') fileId: string) {
    return this.admissions.addDocument(id, type, fileId);
  }

  @Post('documents/:documentId/verify')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  verifyDocument(@Param('documentId') id: string, @Body('verified') verified: boolean) {
    return this.admissions.verifyDocument(id, verified);
  }

  @Post('enroll')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  enroll(@Body() dto: EnrollApplicationDto) {
    return this.admissions.enroll(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  remove(@Param('id') id: string) {
    return this.admissions.remove(id);
  }
}