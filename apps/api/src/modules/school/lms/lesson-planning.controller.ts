import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { LessonPlanningService } from './lesson-planning.service';
import {
  CreateCourseOfferingDto,
  CreateFromTimetableDto,
  CreateLessonPlanDto,
  AddCourseOfferingTeacherDto,
  ReviewLessonPlanDto,
  SaveTemplateDto,
  SubmitLessonPlanDto,
  UpdateLessonPlanDto,
} from './dto.lp';

@Controller('school/lp')
export class LessonPlanningController {
  constructor(private readonly svc: LessonPlanningService) {}

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

  // ── LessonPlan ──
  @Post('lesson-plans')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
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
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  update(@Param('id') id: string, @Body() dto: UpdateLessonPlanDto) {
    return this.svc.updateLessonPlan(id, dto);
  }

  @Post('lesson-plans/:id/submit')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  submit(@Param('id') id: string, @Body() dto: SubmitLessonPlanDto) {
    return this.svc.submitLessonPlan(id, dto);
  }

  @Post('lesson-plans/:id/review')
  @RequirePermissions(PERMISSIONS.school.approveLessonPlans)
  review(@Param('id') id: string, @Body() dto: ReviewLessonPlanDto) {
    return this.svc.reviewLessonPlan(id, dto);
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
  @Post('scheduled-lessons/from-timetable')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  fromTimetable(@Body() dto: CreateFromTimetableDto) {
    return this.svc.createFromTimetable(dto);
  }

  // ── Dashboards / coverage ──
  @Get('teacher-dashboard')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  dashboard(@Query('teacherPartnerId') teacherPartnerId: string) {
    return this.svc.teacherDashboard(teacherPartnerId);
  }

  @Get('curriculum-coverage')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  coverage(@Query('subjectId') subjectId: string, @Query('termId') termId?: string) {
    return this.svc.curriculumCoverage(subjectId, termId);
  }
}
