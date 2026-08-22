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
  ) {}

  // ── Courses ──
  @Get('courses')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listCourses(@Query() q: { termId?: string; classId?: string; subjectId?: string; categoryId?: string }) {
    return this.courses.listCourses(q);
  }

  @Get('courses/:id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  coursePage(@Param('id') id: string, @Query('studentProfileId') studentProfileId?: string) {
    return this.courses.coursePage(id, { studentProfileId, canViewHidden: !studentProfileId });
  }

  @Get('courses/:id/permissions')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  permissions(@Param('id') id: string, @Query('studentProfileId') studentProfileId?: string) {
    const principal = studentProfileId ? { studentProfileId } : { userId: this.tenant.userId };
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
  moveModule(@Param('id') id: string, @Body() dto: { sectionId: string; sequence?: string[] }) {
    return this.modules.move(id, dto);
  }

  @Post('modules/:id/visibility')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  setVisibility(@Param('id') id: string, @Body() dto: { visible?: boolean; visibleOnPage?: boolean }) {
    return this.modules.setVisibility(id, dto);
  }

  @Post('modules/:id/duplicate')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  duplicate(@Param('id') id: string) {
    return this.modules.duplicate(id);
  }

  @Delete('modules/:id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  removeModule(@Param('id') id: string) {
    return this.modules.remove(id);
  }

  @Get('modules/:id/view')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  viewModule(@Param('id') id: string, @Query('studentProfileId') studentProfileId?: string) {
    return this.modules.view(id, { studentProfileId });
  }

  @Post('modules/:id/action/:action')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  actionModule(@Param('id') id: string, @Param('action') action: string, @Body() dto: any) {
    return this.modules.action(id, action, dto, { studentProfileId: dto?.studentProfileId });
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
