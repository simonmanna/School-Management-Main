import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AdmissionsService } from './admissions.service';
import {
  AddExamScoreDto,
  BulkEnrollDto,
  ChargeFeeDto,
  CreateApplicationDto,
  EnrollApplicationDto,
  IssueOfferDto,
  ReEnrollDto,
  ScheduleInterviewDto,
  ScoreApplicationDto,
  TransferInDto,
  UpdateApplicationDto,
  WithdrawStudentDto,
} from './dto.types';

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

  @Post('enroll/bulk')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  bulkEnroll(@Body() dto: BulkEnrollDto) {
    return this.admissions.bulkEnroll(dto);
  }

  @Post(':id/screen')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  screen(@Param('id') id: string) {
    return this.admissions.review(id, 'screen');
  }

  @Post(':id/interview')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  scheduleInterview(@Param('id') id: string, @Body() dto: ScheduleInterviewDto) {
    return this.admissions.scheduleInterview(id, dto);
  }

  @Post(':id/interview/complete')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  completeInterview(@Param('id') id: string, @Body() dto: ScheduleInterviewDto) {
    return this.admissions.completeInterview(id, dto);
  }

  @Post(':id/score')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  scoreApplication(@Param('id') id: string, @Body() dto: ScoreApplicationDto) {
    return this.admissions.scoreApplication(id, dto);
  }

  @Post(':id/offer')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  issueOffer(@Param('id') id: string, @Body() dto: IssueOfferDto) {
    return this.admissions.issueOffer(id, dto);
  }

  @Post(':id/offer/accept')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  acceptOffer(@Param('id') id: string) {
    return this.admissions.acceptOffer(id);
  }

  @Post(':id/offer/decline')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  declineOffer(@Param('id') id: string) {
    return this.admissions.declineOffer(id);
  }

  @Post(':id/fee')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  chargeApplicationFee(@Param('id') id: string, @Body() dto: ChargeFeeDto) {
    return this.admissions.chargeApplicationFee(id, dto);
  }

  @Post('students/transfer-in')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  transferIn(@Body() dto: TransferInDto) {
    return this.admissions.transferIn(dto);
  }

  @Post('students/:id/withdraw')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  withdrawStudent(@Param('id') id: string, @Body() dto: WithdrawStudentDto) {
    return this.admissions.withdrawStudent(id, dto);
  }

  @Post('students/:id/re-enroll')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  reEnroll(@Param('id') id: string, @Body() dto: ReEnrollDto) {
    return this.admissions.reEnroll(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  remove(@Param('id') id: string) {
    return this.admissions.remove(id);
  }
}