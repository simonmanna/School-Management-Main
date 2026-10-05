import {
  Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { LessonPlanningService } from './lesson-planning.service';
import { LessonPlanPdfService } from './lesson-plan-pdf.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import {
  AddCourseOfferingTeacherDto,
  CreateCourseOfferingDto,
  CreateFromTimetableDto,
  CreateLessonPlanDto,
  GenerateWeekPlansDto,
  ReviewLessonPlanDto,
  SaveTemplateDto,
  SubmitLessonPlanDto,
  TransitionLessonPlanDto,
  UpdateLessonPlanDto,
} from './dto.lp';

@Controller('school/lp')
export class LessonPlanningController {
  constructor(
    private readonly svc: LessonPlanningService,
    private readonly identity: EmployeeIdentityService,
    private readonly pdf: LessonPlanPdfService,
  ) {}

  // ── CourseOffering ──
  @Post('course-offerings')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  createOffering(@Body() dto: CreateCourseOfferingDto) {
    return this.svc.upsertCourseOffering(dto);
  }

  @Post('course-offerings/from-teacher-assignment')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  fromTeacherAssignment(@Body() body: { teacherAssignmentId: string; termId: string }) {
    return this.svc.upsertFromTeacherAssignment(body.teacherAssignmentId, body.termId);
  }

  @Get('course-offerings')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listOfferings(@Query('termId') termId?: string) {
    return this.svc.listCourseOfferings(termId);
  }

  @Post('course-offerings/:id/teachers')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  addTeacher(@Param('id') id: string, @Body() dto: AddCourseOfferingTeacherDto) {
    return this.svc.addTeacher(id, dto.teacherPartnerId, dto.role);
  }

  /* ── LessonPlan ──
   *
   * Create, update and submit are gated on `school:lessonplans:own`, not the
   * departmental `:write`. That is what lets a teacher prepare next week's lesson
   * from home without also being able to rewrite a colleague's. The grant alone
   * decides nothing — `LessonPlanningService.assertMayWritePlan` resolves the
   * caller to their StaffProfile and compares it to the plan's owner, letting the
   * departmental grant through unchanged. Review stays on `:approve`: nobody
   * approves their own plan.
   *
   * The Administrator role carries every permission, so this does not lock out
   * existing staff — but a hand-built custom role holding only `:write` would
   * need `:own` adding.
   */
  @Post('lesson-plans')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  create(@Body() dto: CreateLessonPlanDto) {
    return this.svc.createLessonPlan(dto);
  }

  @Get('lesson-plans')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  list(
    @Query('courseOfferingId') courseOfferingId?: string,
    @Query('teacherPartnerId') teacherPartnerId?: string,
    @Query('workflowStatus') workflowStatus?: string,
    @Query('termId') termId?: string,
  ) {
    return this.svc.listLessonPlans({ courseOfferingId, teacherPartnerId, workflowStatus, termId });
  }

  @Get('lesson-plans/:id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  get(@Param('id') id: string) {
    return this.svc.getLessonPlan(id);
  }

  @Put('lesson-plans/:id')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  update(@Param('id') id: string, @Body() dto: UpdateLessonPlanDto) {
    return this.svc.updateLessonPlan(id, dto);
  }

  @Post('lesson-plans/:id/submit')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  submit(@Param('id') id: string, @Body() dto: SubmitLessonPlanDto) {
    return this.svc.submitLessonPlan(id, dto);
  }

  @Post('lesson-plans/:id/review')
  @RequirePermissions(PERMISSIONS.school.approveLessonPlans)
  review(@Param('id') id: string, @Body() dto: ReviewLessonPlanDto) {
    return this.svc.reviewLessonPlan(id, dto);
  }

  /**
   * One workflow move, named by the state to reach.
   *
   * The web client drives its buttons off the target status, so it calls this
   * rather than choosing between `submit` and `review`; both of those remain for
   * callers that want the narrower contract. Permission is the union of the two,
   * and the service re-checks which one actually applies.
   */
  @Post('lesson-plans/:id/transition')
  // The route takes the lower permission; approving is checked per-branch in the
  // service, because @RequirePermissions is an AND and demanding both here would
  // lock out a teacher who may submit but not approve.
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  transition(@Param('id') id: string, @Body() dto: TransitionLessonPlanDto) {
    return this.svc.transitionLessonPlan(id, dto);
  }

  @Post('lesson-plans/:id/archive')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  archive(@Param('id') id: string) {
    return this.svc.archiveLessonPlan(id);
  }

  @Post('lesson-plans/:id/save-template')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  saveTemplate(@Param('id') id: string, @Body() dto: SaveTemplateDto) {
    return this.svc.saveTemplate(id, dto);
  }

  @Get('templates')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listTemplates(@Query('subjectId') subjectId?: string) {
    return this.svc.listTemplates(subjectId);
  }

  // ── Timetable integration ──
  /**
   * Draft a plan for every lesson in a week, from the timetable and the scheme
   * of work. `ownLessonPlans` is enough: the service refuses to write a plan
   * the caller does not own unless they hold the departmental grant.
   */
  @Post('lesson-plans/generate-week')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  generateWeekPlans(@Body() dto: GenerateWeekPlansDto) {
    return this.svc.generateWeekPlans(dto);
  }

  /**
   * The printable plan, for an inspection file or a head of department's
   * signature. Read-level grant: printing shows nothing the plan screen does
   * not, and a teacher must be able to print their own.
   */
  @Get('lesson-plans/:id/pdf')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async lessonPlanPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.pdf.lessonPlanPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  /** The term's scheme of work for one course, by week. */
  @Get('course-offerings/:id/scheme/pdf')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async schemePdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.pdf.schemeOfWorkPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Post('scheduled-lessons/from-timetable')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  fromTimetable(@Body() dto: CreateFromTimetableDto) {
    return this.svc.createFromTimetable(dto);
  }

  // ── Dashboards / coverage ──
  @Get('teacher-dashboard')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  async dashboard(@Query('teacherPartnerId') teacherPartnerId: string) {
    await this.identity.assertIsTeacherOrAdmin(teacherPartnerId, PERMISSIONS.school.manageLessonPlans);
    return this.svc.teacherDashboard(teacherPartnerId);
  }

  @Get('curriculum-coverage')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  coverage(@Query('subjectId') subjectId: string, @Query('termId') termId?: string) {
    return this.svc.curriculumCoverage(subjectId, termId);
  }
}
