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

  @Post('identity-matches/:id/review')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  reviewIdentityMatch(@Param('id') id: string, @Body('decision') decision: 'confirmed_same' | 'dismissed') {
    return this.admissions.reviewIdentityMatch(id, decision);
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
  addDocument(
    @Param('id') id: string,
    @Body('type') type: string,
    @Body('fileId') fileId: string,
    @Body('required') required?: boolean,
  ) {
    return this.admissions.addDocument(id, type, fileId, required);
  }

  @Post('documents/:documentId/verify')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  verifyDocument(
    @Param('documentId') id: string,
    @Body('verified') verified: boolean,
    @Body('rejectionReason') rejectionReason?: string,
  ) {
    return this.admissions.verifyDocument(id, verified, rejectionReason);
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

  /**
   * Settle (or waive) the application fee. `markFeePaid` previously had no
   * caller at all, so a raised fee invoice could never be marked paid and the
   * enrollment fee gate could never be satisfied.
   *
   * NOTE (Phase 2): the fine-grained grants `school:admissions:fee`,
   * `:interview` and `:offer` exist in PERMISSIONS but are not applied here yet.
   * PermissionsGuard ANDs the required list, so narrowing these routes without
   * first backfilling the grant onto existing admissions roles would lock out
   * every current user. Do the role backfill and the narrowing together.
   */
  @Post(':id/fee/settle')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  settleApplicationFee(@Param('id') id: string, @Body('waived') waived?: boolean) {
    return this.admissions.markFeePaid(id, waived === true);
  }

  /** Expire every issued offer whose expiresAt has passed. Safe to re-run. */
  @Post('offers/expire-lapsed')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  expireLapsedOffers() {
    return this.admissions.expireLapsedOffers();
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

  // ---- Phase 3–5: Cycles, Capacity, Criteria, Scoring, Decisions, Analytics ----
  @Post('cycles')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  createCycle(@Body() dto: { academicYearId: string; name: string; opensAt?: string; closesAt?: string }) {
    return this.admissions.createCycle(dto);
  }

  @Get('cycles')
  @RequirePermissions(PERMISSIONS.school.read)
  listCycles(@Query('academicYearId') academicYearId?: string) {
    return this.admissions.listCycles(academicYearId);
  }

  @Post('capacity')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  setCapacity(@Body() dto: { admissionCycleId: string; classId: string; capacity: number; sectionId?: string; streamId?: string; campusId?: string; reservedCapacity?: number }) {
    return this.admissions.setCapacity(dto);
  }

  @Get('capacity/:cycleId/status')
  @RequirePermissions(PERMISSIONS.school.read)
  capacityStatus(@Param('cycleId') cycleId: string) {
    return this.admissions.capacityStatus(cycleId);
  }

  @Post('criteria-sets')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  createCriteriaSet(@Body() dto: { admissionCycleId: string; name: string; classId?: string; isDefault?: boolean; criteria: Array<{ name: string; weight: number; maxScore?: number; required?: boolean; passMark?: number }> }) {
    return this.admissions.createCriteriaSet(dto);
  }

  @Post(':id/score-weighted')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  scoreApplicationWeighted(@Param('id') id: string, @Body() scores: Record<string, number>) {
    return this.admissions.scoreApplicationWeighted(id, scores);
  }

  @Post(':id/decision')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  recordDecision(@Param('id') id: string, @Body('decision') decision: 'accepted' | 'rejected' | 'waitlisted', @Body('reason') reason?: string) {
    return this.admissions.recordDecision(id, decision, reason);
  }

  @Get(':id/eligibility')
  @RequirePermissions(PERMISSIONS.school.read)
  enrollmentEligibility(@Param('id') id: string) {
    return this.admissions.enrollmentEligibility(id);
  }

  @Post('waitlist/:classId/rank')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  rankWaitlist(@Param('classId') classId: string) {
    return this.admissions.rankWaitlist(classId);
  }

  @Post('enroll/bulk/preview')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  bulkEnrollPreview(@Body('items') items: Array<{ applicationId: string; classId: string; sectionId?: string; streamId?: string; termId: string; rollNumber: string }>) {
    return this.admissions.bulkEnrollPreview(items);
  }

  @Get('metrics/pipeline')
  @RequirePermissions(PERMISSIONS.school.read)
  pipelineMetrics() {
    return this.admissions.pipelineMetrics();
  }

  @Get('reports/enrollment-summary')
  @RequirePermissions(PERMISSIONS.school.read)
  enrollmentSummary(@Query('termId') termId?: string) {
    return this.admissions.enrollmentSummary(termId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  remove(@Param('id') id: string) {
    return this.admissions.remove(id);
  }
}