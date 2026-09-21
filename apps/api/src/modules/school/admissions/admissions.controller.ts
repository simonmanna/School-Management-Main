import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AdmissionsService } from './admissions.service';
import { AdmissionFeeService } from './admission-fee.service';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import {
  AddExamScoreDto,
  BulkEnrollDto,
  ChargeFeeDto,
  PayApplicationFeeDto,
  WaiveApplicationFeeDto,
  CreateApplicationDto,
  CreateNationalityDto,
  EnrollApplicationDto,
  IssueOfferDto,
  ReEnrollDto,
  ReviewApplicationDto,
  ScheduleInterviewDto,
  ScoreApplicationDto,
  TransferInDto,
  UpdateApplicationDto,
  UpdateNationalityDto,
  WithdrawStudentDto,
} from './dto.types';

@Controller('school/admissions')
export class AdmissionsController {
  constructor(
    private readonly admissions: AdmissionsService,
    private readonly admissionFees: AdmissionFeeService,
  ) {}

  /**
   * Each row carries its resolved workflow actions so the pipeline table can render
   * the right buttons without an N+1 of per-application workflow requests.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.admissions.listWithWorkflow(q);
  }

  @Get('by-status/:status')
  @RequirePermissions(PERMISSIONS.school.read)
  byStatus(@Param('status') status: string) {
    return this.admissions.byStatus(status);
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

  /**
   * The action union here listed only 5 of the 15 the service accepts, which is
   * part of why the UI never exposed screening, interviews, scoring or waitlisting.
   * `review()` validates the action against the FSM regardless, so an unknown
   * action is a 400, not a bad write.
   */
  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  review(@Param('id') id: string, @Body() dto: ReviewApplicationDto) {
    return this.admissions.review(id, dto.action, dto.reason ?? dto.notes);
  }

  // ── Nationalities (org-scoped master data) ──
  @Get('nationalities')
  @RequirePermissions(PERMISSIONS.school.read)
  listNationalities() {
    return this.admissions.listNationalities();
  }

  @Post('nationalities')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  createNationality(@Body() dto: CreateNationalityDto) {
    return this.admissions.createNationality(dto);
  }

  @Patch('nationalities/:id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  updateNationality(@Param('id') id: string, @Body() dto: UpdateNationalityDto) {
    return this.admissions.updateNationality(id, dto);
  }

  /** Submit a draft into the pipeline (draft → submitted | documents_pending). */
  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  submit(@Param('id') id: string) {
    return this.admissions.submitApplication(id);
  }

  /** The append-only status timeline for one application. */
  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.school.read)
  history(@Param('id') id: string) {
    return this.admissions.statusHistory(id);
  }

  /** Reveal the decrypted NIN (separately audited PII access). */
  @Post(':id/reveal-nin')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  revealNin(@Param('id') id: string) {
    return this.admissions.revealNin(id);
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

  /** Fee position read from the invoice subledger: invoice, allocations, state. */
  @Get(':id/fee')
  @RequirePermissions(PERMISSIONS.school.read)
  applicationFeeStatus(@Param('id') id: string) {
    return this.admissionFees.status(id);
  }

  /** Charge (or re-charge an unpaid) application fee as a posted invoice. */
  @Post(':id/fee')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  chargeApplicationFee(@Param('id') id: string, @Body() dto: ChargeFeeDto) {
    return this.admissionFees.charge(id, dto);
  }

  /** Receive payment against the fee invoice through the payment engine. */
  @Post(':id/fee/pay')
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent()
  @RequirePermissions(PERMISSIONS.school.manageAdmissions, PERMISSIONS.school.collectPayments)
  payApplicationFee(@Param('id') id: string, @Body() dto: PayApplicationFeeDto) {
    return this.admissionFees.pay(id, dto);
  }

  /** Waive an unpaid fee: the invoice is voided and its journal reversed. */
  @Post(':id/fee/waive')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions, PERMISSIONS.school.approveWaivers)
  waiveApplicationFee(@Param('id') id: string, @Body() dto: WaiveApplicationFeeDto) {
    return this.admissionFees.waive(id, dto.reason);
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
  setCapacity(@Body() dto: { admissionCycleId: string; classId: string; capacity: number; sectionId?: string; campusId?: string; reservedCapacity?: number }) {
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

  /**
   * Everything the UI needs to render this application's controls: stage state,
   * the next required stage, the permitted required/optional actions, and the
   * eligibility verdict. Workflow and eligibility stay orthogonal — the client picks
   * which buttons exist from the action lists and whether they are enabled from
   * `eligibility`. Guidance only: every mutating endpoint re-checks all of it.
   */
  @Get(':id/workflow')
  @RequirePermissions(PERMISSIONS.school.read)
  applicationWorkflow(@Param('id') id: string) {
    return this.admissions.applicationWorkflow(id);
  }

  @Post('waitlist/:classId/rank')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  rankWaitlist(@Param('classId') classId: string) {
    return this.admissions.rankWaitlist(classId);
  }

  @Post('enroll/bulk/preview')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  bulkEnrollPreview(@Body('items') items: Array<{ applicationId: string; classId: string; sectionId?: string; termId: string; rollNumber: string }>) {
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

  // Registered AFTER the static collection routes (cycles, nationalities, …) so
  // Express matches those before this catch-all `:id` param route.
  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.admissions.findOne(id);
  }
}