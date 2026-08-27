import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AdmissionsConfigService } from './admissions-config.service';
import { AdmissionsCommitteeService } from './admissions-committee.service';
import { AdmissionsAnalyticsService } from './admissions-analytics.service';
import { AdmissionsWorkflowService } from './admissions-workflow.service';

/**
 * Configuration, committee and analytics endpoints for admissions. Kept in a
 * separate controller from the core FSM controller so each stays readable.
 */
@Controller('school/admissions')
export class AdmissionsConfigController {
  constructor(
    private readonly config: AdmissionsConfigService,
    private readonly committee: AdmissionsCommitteeService,
    private readonly analytics: AdmissionsAnalyticsService,
    private readonly workflow: AdmissionsWorkflowService,
  ) {}

  // ── Admission workflow ──
  //
  // Declared FIRST, above every `:id`-prefixed route in this module. Nest matches in
  // declaration order, so `workflows/schema` would otherwise bind as `:id = "workflows"`
  // on a two-segment param route — the shadowing bug fixed in 016596b.
  //
  // Mutations are gated on the existing `manageAdmissions` grant. A dedicated
  // `school:admissions:workflow` permission is registered but NOT enforced: the guard
  // ANDs its requirements, and the admissions sub-grants are still dormant pending a
  // role backfill, so enforcing a new one here would 403 every current administrator.

  @Get('workflows/schema')
  @RequirePermissions(PERMISSIONS.school.read)
  workflowSchema() {
    return this.workflow.schema();
  }

  @Get('workflows')
  @RequirePermissions(PERMISSIONS.school.read)
  listWorkflows() {
    return this.workflow.list();
  }

  @Post('workflows')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  createWorkflow(@Body() dto: any) {
    return this.workflow.create(dto);
  }

  @Patch('workflows/:workflowId')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  updateWorkflow(@Param('workflowId') workflowId: string, @Body() dto: any) {
    return this.workflow.update(workflowId, dto);
  }

  @Post('workflows/:workflowId/preset')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  applyWorkflowPreset(@Param('workflowId') workflowId: string, @Body() dto: { presetKey: string }) {
    return this.workflow.applyPreset(workflowId, dto.presetKey);
  }

  /** Archive, never hard-delete — a workflow is configuration history. */
  @Delete('workflows/:workflowId')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  archiveWorkflow(@Param('workflowId') workflowId: string) {
    return this.workflow.archive(workflowId);
  }

  /**
   * Assign a workflow to an admission cycle. Governs applications created from now on:
   * existing applications keep the snapshot they were created with.
   */
  @Patch('cycles/:cycleId/workflow')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  assignCycleWorkflow(@Param('cycleId') cycleId: string, @Body() dto: { workflowId: string | null }) {
    return this.workflow.assignToCycle(cycleId, dto.workflowId ?? null);
  }

  // ── Requirements ──
  @Get('requirements')
  @RequirePermissions(PERMISSIONS.school.read)
  listRequirements(@Query('admissionCycleId') cycleId?: string) {
    return this.config.listRequirements(cycleId);
  }

  @Put('requirements')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  upsertRequirement(@Body() dto: any) {
    return this.config.upsertRequirement(dto);
  }

  @Delete('requirements/:id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  removeRequirement(@Param('id') id: string) {
    return this.config.removeRequirement(id);
  }

  // ── Offer templates ──
  @Get('offer-templates')
  @RequirePermissions(PERMISSIONS.school.read)
  listOfferTemplates() {
    return this.config.listOfferTemplates();
  }

  @Put('offer-templates')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  upsertOfferTemplate(@Body() dto: any) {
    return this.config.upsertOfferTemplate(dto);
  }

  @Delete('offer-templates/:id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  removeOfferTemplate(@Param('id') id: string) {
    return this.config.removeOfferTemplate(id);
  }

  // ── Enquiries / leads ──
  @Get('enquiries')
  @RequirePermissions(PERMISSIONS.school.read)
  listEnquiries(@Query('status') status?: string) {
    return this.config.listEnquiries(status);
  }

  @Post('enquiries')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  createEnquiry(@Body() dto: any) {
    return this.config.createEnquiry(dto);
  }

  @Put('enquiries/:id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  updateEnquiry(@Param('id') id: string, @Body() dto: any) {
    return this.config.updateEnquiry(id, dto);
  }

  @Post('enquiries/:id/convert')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  convertEnquiry(@Param('id') id: string, @Body('applicationId') applicationId: string) {
    return this.config.markEnquiryConverted(id, applicationId);
  }

  @Delete('enquiries/:id')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  removeEnquiry(@Param('id') id: string) {
    return this.config.removeEnquiry(id);
  }

  // ── Committee / reviewers ──
  @Post(':id/reviewers')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  assignReviewers(@Param('id') id: string, @Body('reviewerIds') reviewerIds: string[], @Body('role') role?: string) {
    return this.committee.assignReviewers(id, reviewerIds, role);
  }

  @Get(':id/reviewers')
  @RequirePermissions(PERMISSIONS.school.read)
  listReviews(@Param('id') id: string) {
    return this.committee.listReviews(id);
  }

  @Get(':id/committee-summary')
  @RequirePermissions(PERMISSIONS.school.read)
  committeeSummary(@Param('id') id: string, @Query('quorum') quorum?: string) {
    return this.committee.committeeSummary(id, quorum ? Number(quorum) : 1);
  }

  @Post('reviews/:assignmentId')
  @RequirePermissions(PERMISSIONS.school.manageAdmissions)
  submitReview(@Param('assignmentId') assignmentId: string, @Body() dto: any) {
    return this.committee.submitReview(assignmentId, dto);
  }

  @Get('reviewers/:reviewerId/queue')
  @RequirePermissions(PERMISSIONS.school.read)
  myQueue(@Param('reviewerId') reviewerId: string, @Query('status') status?: string) {
    return this.committee.myQueue(reviewerId, status);
  }

  // ── Analytics ──
  @Get('analytics/funnel')
  @RequirePermissions(PERMISSIONS.school.read)
  funnel(@Query('academicYearId') yearId?: string) {
    return this.analytics.funnel(yearId);
  }

  @Get('analytics/by-source')
  @RequirePermissions(PERMISSIONS.school.read)
  bySource(@Query('academicYearId') yearId?: string) {
    return this.analytics.bySource(yearId);
  }

  @Get('analytics/by-class')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Query('academicYearId') yearId?: string) {
    return this.analytics.byClass(yearId);
  }

  @Get('analytics/processing-time')
  @RequirePermissions(PERMISSIONS.school.read)
  processingTime(@Query('academicYearId') yearId?: string) {
    return this.analytics.processingTime(yearId);
  }
}
