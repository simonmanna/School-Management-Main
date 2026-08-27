import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../kernel/auth/decorators/require-permissions.decorator';
import { EnrolmentService } from './enrolment/enrolment.service';
import { GroupsService } from './groups/groups.service';
import { CompletionService } from './completion/completion.service';
import { GradebookService } from './gradebook/gradebook.service';
import { LmsReportsService } from './reports/reports.service';
import { BadgesService } from './badges/badges.service';
import { CourseModuleService } from './course/module.service';
import { PortalIdentityService } from '../../../../kernel/auth/portal-identity.service';
import { TenantContextService } from '../../../../kernel/tenancy/tenant-context.service';
import { LmsCapabilityGuard } from './context/capability.guard';
import { RequireCapability } from './context/require-capability.decorator';
import { CAP } from './capabilities';
import { LmsOrphanCheckService } from './maintenance/orphan-check.service';
import { CapabilityService } from './context/capability.service';
import { LmsCalendarService } from './reports/lms-calendar.service';
import { CourseBackupService } from './backup/course-backup.service';

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
    private readonly portalIdentity: PortalIdentityService,
    private readonly orphans: LmsOrphanCheckService,
    private readonly tenant: TenantContextService,
    private readonly caps: CapabilityService,
    private readonly calendar: LmsCalendarService,
    private readonly backup: CourseBackupService,
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
  /**
   * Tick or untick a manual-completion activity.
   *
   * The subject is resolved from the token, not the body. A student ticks their
   * own box; staff overriding someone else's need `lms/completion:override`,
   * which the guard enforces — previously `dto.studentProfileId` was trusted, so
   * anyone could mark a classmate's work complete.
   */
  @Post('modules/:id/completion')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.activityView, 'moduleParam')
  async setCompletion(@Param('id') id: string, @Body() dto: { asStudent?: string; state: any }) {
    const principal = this.portalIdentity.principal();
    let target: string | undefined;
    if (principal.kind === 'student') {
      if (dto.asStudent && dto.asStudent !== principal.studentProfileId) {
        throw new ForbiddenException('You may only update your own completion');
      }
      target = principal.studentProfileId;
    } else if (principal.kind === 'guardian') {
      // Reading a child's course is fine; completing their work for them is not.
      throw new ForbiddenException('Guardians cannot change completion on a student behalf');
    } else {
      if (!dto.asStudent) throw new ForbiddenException('Name the student whose completion to override');
      const cm = await this.modules.get(id);
      const allowed = await this.caps.canAtCourse(
        { userId: principal.userId }, CAP.completionOverride, cm.courseOfferingId,
      );
      if (!allowed) throw new ForbiddenException('Missing capability to override completion');
      target = dto.asStudent;
    }
    await this.completion.setManual(id, target!, dto.state);
    return { ok: true };
  }

  @Get('courses/:id/completion-report')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  completionReport(@Param('id') id: string) { return this.completion.matrix(id); }


  /**
   * Refuse a per-student read that the caller has no claim to. Staff still need
   * the course-level capability, which the guard on each route applies; this stops
   * one family reading another's progress or grades.
   */
  private async assertMaySeeStudent(studentProfileId: string): Promise<void> {
    if (!(await this.portalIdentity.canAccessStudent(studentProfileId))) {
      throw new ForbiddenException('Not permitted to view this student');
    }
  }

  @Get('courses/:id/progress/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseView, 'courseParam')
  async progress(@Param('id') id: string, @Param('studentProfileId') sp: string) {
    await this.assertMaySeeStudent(sp);
    return { progressPct: await this.completion.rollupCourse(id, sp) };
  }

  // ── Gradebook (P5) ──
  @Get('courses/:id/gradebook')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.gradeViewAll, 'courseParam')
  gradebookReport(@Param('id') id: string) { return this.gradebook.graderReport(id); }

  @Get('courses/:id/gradebook/user/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.gradeView, 'courseParam')
  async userReport(@Param('id') id: string, @Param('studentProfileId') sp: string) {
    await this.assertMaySeeStudent(sp);
    return this.gradebook.userReport(id, sp, { includeHidden: false });
  }

  @Patch('courses/:id/gradebook/cell')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.gradeEdit, 'courseParam')
  editCell(@Body() dto: { studentAssessmentId: string; score: number }) { return this.gradebook.editCell(dto); }

  @Post('courses/:id/gradebook/override')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.gradeEdit, 'courseParam')
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
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  logs(@Param('id') id: string, @Query() q: any) { return this.reports.logs(id, q); }

  @Get('courses/:id/activity-report')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  activityReport(@Param('id') id: string) { return this.reports.activityReport(id); }

  @Get('courses/:id/participation')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  participation(@Param('id') id: string, @Query('action') action?: string) { return this.reports.participation(id, { action }); }

  @Get('courses/:id/outline')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
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

  // ── Maintenance (L0.4) ──

  /**
   * Course modules whose per-type instance row has vanished. ADR-014 accepted an
   * untyped polymorphic `instanceId` on condition this check exists.
   */
  @Get('maintenance/orphans')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  scanOrphans() {
    return this.orphans.scan(this.tenant.organizationId);
  }

  /** Soft-delete confirmed orphans. Re-verifies each id before touching it. */
  @Post('maintenance/orphans/repair')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  repairOrphans(@Body() dto: { courseModuleIds: string[] }) {
    return this.orphans.repair(this.tenant.organizationId, dto?.courseModuleIds ?? []);
  }

  // ── Calendar + engagement (L5.2 / L6) ──

  /**
   * Deadlines and lessons in a window. A read model over `CourseModule.dueAt` and
   * `ScheduledLesson` — no calendar table, so a moved deadline is never stale.
   */
  @Get('calendar')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  calendarRange(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('asStudent') asStudent?: string,
    @Query('courseOfferingId') courseOfferingId?: string,
  ) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(Date.now() + 30 * 86400000);
    return this.calendar.range({ from: start, to: end, asStudent, courseOfferingId });
  }

  /** Who has stopped working: events, distinct activities, last seen. */
  @Get('courses/:id/engagement')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  engagement(@Param('id') id: string) {
    return this.reports.engagement(id);
  }

  /** Pupils who have not opened a given activity, by name. */
  @Get('courses/:id/not-viewed/:moduleId')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseViewReports, 'courseParam')
  notViewed(@Param('id') id: string, @Param('moduleId') moduleId: string) {
    return this.reports.notViewed(id, moduleId);
  }

  // ── Backup / restore / rollover (L8) ──

  @Post('courses/:id/export')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseBackup, 'courseParam')
  exportCourse(@Param('id') id: string, @Body() dto: { includeUserData?: boolean }) {
    return this.backup.export(id, { includeUserData: Boolean(dto?.includeUserData) });
  }

  @Post('courses/:id/import')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseBackup, 'courseParam')
  importCourse(@Param('id') id: string, @Body() dto: { bundle: any; includeUserData?: boolean }) {
    return this.backup.import(id, dto?.bundle, { includeUserData: Boolean(dto?.includeUserData) });
  }

  /**
   * Clone a term's course structures into the next term. Never carries pupils,
   * submissions or marks, and refuses a target that already has activities.
   */
  @Post('courses/rollover')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  rollover(@Body() dto: { fromTermId: string; toTermId: string; offeringIds?: string[] }) {
    return this.backup.rollover(dto);
  }
}
