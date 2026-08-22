import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../kernel/auth/decorators/require-permissions.decorator';
import { EnrolmentService } from './enrolment/enrolment.service';
import { GroupsService } from './groups/groups.service';
import { CompletionService } from './completion/completion.service';
import { GradebookService } from './gradebook/gradebook.service';
import { LmsReportsService } from './reports/reports.service';
import { BadgesService } from './badges/badges.service';
import { CourseModuleService } from './course/module.service';

/** P4/P5/P7 — enrolment, groups, completion, gradebook, reports, badges (ADR-014 §5). */
@Controller('school/lms')
export class LmsOpsController {
  constructor(
    private readonly enrolment: EnrolmentService,
    private readonly groups: GroupsService,
    private readonly completion: CompletionService,
    private readonly gradebook: GradebookService,
    private readonly reports: LmsReportsService,
    private readonly badges: BadgesService,
    private readonly modules: CourseModuleService,
  ) {}

  // ── Enrolment (P4) ──
  @Get('courses/:id/enrolment-methods')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  methods(@Param('id') id: string) { return this.enrolment.listMethods(id); }

  @Get('courses/:id/enrolments')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  enrolments(@Param('id') id: string, @Query('status') status?: 'active' | 'suspended') { return this.enrolment.listEnrolments(id, { status }); }

  @Post('courses/:id/enrol')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  enrol(@Param('id') id: string, @Body() dto: any) { return this.enrolment.enrol(id, dto); }

  @Post('courses/:id/enrol/sync')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  syncRoster(@Param('id') id: string) { return this.enrolment.syncRoster(id); }

  @Patch('enrolments/:id')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  setEnrolStatus(@Param('id') id: string, @Body() dto: { status: 'active' | 'suspended' }) { return this.enrolment.setStatus(id, dto.status); }

  // ── Groups (P4) ──
  @Get('courses/:id/groups')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listGroups(@Param('id') id: string) { return this.groups.listGroups(id); }

  @Post('courses/:id/groups')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  createGroup(@Param('id') id: string, @Body() dto: any) { return this.groups.createGroup(id, dto); }

  @Post('groups/:id/members')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  addMember(@Param('id') id: string, @Body() dto: any) { return this.groups.addMember(id, dto); }

  @Get('groups/:id/members')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  members(@Param('id') id: string) { return this.groups.members(id); }

  @Get('courses/:id/groupings')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listGroupings(@Param('id') id: string) { return this.groups.listGroupings(id); }

  @Post('courses/:id/groupings')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  createGrouping(@Param('id') id: string, @Body() dto: any) { return this.groups.createGrouping(id, dto); }

  // ── Completion (P4) ──
  @Post('modules/:id/completion')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async setCompletion(@Param('id') id: string, @Body() dto: { studentProfileId: string; state: any }) {
    await this.completion.setManual(id, dto.studentProfileId, dto.state);
    return { ok: true };
  }

  @Get('courses/:id/completion-report')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  completionReport(@Param('id') id: string) { return this.completion.matrix(id); }

  @Get('courses/:id/progress/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async progress(@Param('id') id: string, @Param('studentProfileId') sp: string) {
    return { progressPct: await this.completion.rollupCourse(id, sp) };
  }

  // ── Gradebook (P5) ──
  @Get('courses/:id/gradebook')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  gradebookReport(@Param('id') id: string) { return this.gradebook.graderReport(id); }

  @Get('courses/:id/gradebook/user/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  userReport(@Param('id') id: string, @Param('studentProfileId') sp: string) { return this.gradebook.userReport(id, sp, { includeHidden: false }); }

  @Patch('courses/:id/gradebook/cell')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  editCell(@Body() dto: { studentAssessmentId: string; score: number }) { return this.gradebook.editCell(dto); }

  @Post('courses/:id/gradebook/override')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  override(@Body() dto: { studentAssessmentId: string; score: number; reason?: string }) { return this.gradebook.override(dto); }

  @Get('courses/:id/gradebook/export')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  exportGrades(@Param('id') id: string) { return this.gradebook.exportCsv(id); }

  @Post('courses/:id/gradebook/import')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  importGrades(@Body() dto: { rows: { studentAssessmentId: string; score: number }[] }) { return this.gradebook.importScores(dto.rows); }

  // ── Reports (P7) ──
  @Get('courses/:id/logs')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  logs(@Param('id') id: string, @Query() q: any) { return this.reports.logs(id, q); }

  @Get('courses/:id/activity-report')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  activityReport(@Param('id') id: string) { return this.reports.activityReport(id); }

  @Get('courses/:id/participation')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  participation(@Param('id') id: string, @Query('action') action?: string) { return this.reports.participation(id, { action }); }

  @Get('courses/:id/outline')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  outline(@Param('id') id: string) { return this.reports.outline(id); }

  // ── Badges (P7) ──
  @Get('badges')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listBadges(@Query('courseOfferingId') courseOfferingId?: string) { return this.badges.list(courseOfferingId); }

  @Post('badges')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  createBadge(@Body() dto: any) { return this.badges.create(dto); }

  @Post('badges/:id/award')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  awardBadge(@Param('id') id: string, @Body() dto: any) { return this.badges.award(id, dto); }
}
