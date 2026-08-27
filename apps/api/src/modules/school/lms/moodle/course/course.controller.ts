import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { CourseService } from './course.service';
import { CourseModuleService } from './module.service';
import { QuestionBankService } from './question-bank.service';
import { PlanPublishService } from '../bridge/plan-publish.service';
import { CapabilityService } from '../context/capability.service';
import { LmsCapabilityGuard } from '../context/capability.guard';
import { RequireCapability } from '../context/require-capability.decorator';
import { CAP } from '../capabilities';
import { PortalIdentityService } from '../../../../../kernel/auth/portal-identity.service';

/** P1/P6/P7 — course spine, activity delivery, question bank, plan bridge (ADR-014 §5). */
@Controller('school/lms')
export class LmsCourseController {
  constructor(
    private readonly courses: CourseService,
    private readonly modules: CourseModuleService,
    private readonly questionBank: QuestionBankService,
    private readonly planPublish: PlanPublishService,
    private readonly caps: CapabilityService,
    private readonly tenant: TenantContextService,
    private readonly portalIdentity: PortalIdentityService,
  ) {}

  // ── Courses ──
  @Get('courses')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listCourses(@Query() q: { termId?: string; classId?: string; subjectId?: string; categoryId?: string }) {
    return this.courses.listCourses(q);
  }

  @Get('courses/:id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseView, 'courseParam')
  async coursePage(@Param('id') id: string, @Query('asStudent') asStudent?: string) {
    const principal = this.portalIdentity.principal();
    const studentProfileId =
      principal.kind === 'student'
        ? principal.studentProfileId
        : asStudent && (await this.portalIdentity.canAccessStudent(asStudent))
          ? asStudent
          : undefined;
    // Hidden content is a staff view. It used to be granted by simply omitting
    // the student parameter, which is why a student could see unpublished work.
    const canViewHidden =
      principal.kind === 'staff' &&
      !studentProfileId &&
      (await this.caps.canAtCourse({ userId: principal.userId }, CAP.courseViewHidden, id));
    return this.courses.coursePage(id, { studentProfileId, canViewHidden });
  }

  /** Effective capabilities for the CALLER. There is no way to ask about someone else. */
  @Get('courses/:id/permissions')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  permissions(@Param('id') id: string) {
    const p = this.portalIdentity.principal();
    const principal =
      p.kind === 'student' ? { studentProfileId: p.studentProfileId } : { userId: this.tenant.userId };
    return this.caps.effectiveAtCourse(principal, id);
  }

  @Patch('courses/:id/settings')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManage, 'courseParam')
  updateSettings(@Param('id') id: string, @Body() dto: any) {
    return this.courses.updateSettings(id, dto);
  }

  @Post('courses/:id/sections/ensure')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  ensureSections(@Param('id') id: string) {
    return this.courses.ensureSections(id);
  }

  @Post('courses/:id/sections')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'courseParam')
  addSection(@Param('id') id: string, @Body() dto: { name?: string; summary?: string }) {
    return this.courses.addSection(id, dto);
  }

  @Patch('sections/:id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'sectionParam')
  updateSection(@Param('id') id: string, @Body() dto: any) {
    return this.courses.updateSection(id, dto);
  }

  @Post('sections/:id/move')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  moveSection(@Param('id') id: string, @Body() dto: { toSectionNo: number }) {
    return this.courses.moveSection(id, dto.toSectionNo);
  }

  @Delete('sections/:id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  deleteSection(@Param('id') id: string) {
    return this.courses.softDeleteSection(id);
  }

  // ── Modules ──
  @Post('courses/:id/modules')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'courseParam')
  addModule(@Param('id') id: string, @Body() dto: any) {
    return this.modules.add(id, dto);
  }

  @Patch('modules/:id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  updateModule(@Param('id') id: string, @Body() dto: any) {
    return this.modules.updateSpine(id, dto);
  }

  @Patch('modules/:id/instance')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  updateInstance(@Param('id') id: string, @Body() dto: any) {
    return this.modules.updateInstance(id, dto);
  }

  @Post('modules/:id/move')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  moveModule(@Param('id') id: string, @Body() dto: { sectionId: string; sequence?: string[] }) {
    return this.modules.move(id, dto);
  }

  @Post('modules/:id/visibility')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  setVisibility(@Param('id') id: string, @Body() dto: { visible?: boolean; visibleOnPage?: boolean }) {
    return this.modules.setVisibility(id, dto);
  }

  @Post('modules/:id/duplicate')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  duplicate(@Param('id') id: string) {
    return this.modules.duplicate(id);
  }

  @Delete('modules/:id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.courseManageActivities, 'moduleParam')
  removeModule(@Param('id') id: string) {
    return this.modules.remove(id);
  }

  /**
   * `asStudent` is a REQUEST, not an assertion: the service checks it against the
   * caller's verified portal claim and refuses if they are not that student (or a
   * guardian of them, or staff with the capability to preview). It is not a way to
   * name yourself — a student's own subject comes from their token.
   */
  @Get('modules/:id/view')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.activityView, 'moduleParam')
  viewModule(@Param('id') id: string, @Query('asStudent') asStudent?: string) {
    return this.modules.view(id, { asStudent });
  }

  @Post('modules/:id/action/:action')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  @UseGuards(LmsCapabilityGuard)
  @RequireCapability(CAP.activityView, 'moduleParam')
  actionModule(@Param('id') id: string, @Param('action') action: string, @Body() dto: any) {
    // The subject is resolved from the token; `dto.studentProfileId` is ignored
    // deliberately, so an old client cannot act as someone else.
    return this.modules.action(id, action, dto, { asStudent: dto?.asStudent });
  }

  // ── Question bank (P6) ──
  @Get('question-categories')
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  listCategories(@Query('courseOfferingId') courseOfferingId?: string) {
    return this.questionBank.listCategories({ courseOfferingId });
  }

  @Post('question-categories')
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  createCategory(@Body() dto: any) {
    return this.questionBank.createCategory(dto);
  }

  @Post('questions/:id/version')
  @RequirePermissions(PERMISSIONS.school.manageQuestionBank)
  versionQuestion(@Param('id') id: string, @Body() dto: { snapshot: unknown }) {
    return this.questionBank.versionQuestion(id, dto.snapshot);
  }

  // ── Plan bridge (P7) ──
  @Post('lesson-plans/:id/publish-to-course')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  publishToCourse(@Param('id') id: string, @Body() dto: { courseOfferingId: string; sectionNo?: number }) {
    return this.planPublish.publishToCourse(id, dto);
  }

  @Get('courses/:id/plan-coverage')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  coverage(@Param('id') id: string) {
    return this.planPublish.coverage(id);
  }
}
