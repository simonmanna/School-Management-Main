import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { SchemeOfWorkService } from './scheme-of-work.service';
import { LessonDeliveryService } from './lesson-delivery.service';
import { TeachingWorkspaceService } from './teaching-workspace.service';
import {
  AddEvidenceDto,
  AttachLessonPlanDto,
  AttachOfferingResourceDto,
  CreateFollowUpDto,
  CreateSchemeOfWorkDto,
  DeliverLessonDto,
  GenerateWeekDto,
  ReflectLessonDto,
  SchemeItemDto,
  SetPlanOutcomesDto,
  SetPlanSchemeWeekDto,
  UpdateFollowUpDto,
  UpdateSchemeOfWorkDto,
  UpsertSchemeWeekDto,
} from './teaching.dto';

/**
 * Phase 3 — the teacher's week, end to end.
 *
 * Every route is scoped to a course offering and every offering is checked
 * against the caller's allocation (TeachingAccessService), so `school:lms:read`
 * means "may use the teaching workspace", never "may read every teacher's".
 */
@Controller('school/teaching')
export class TeachingController {
  constructor(
    private readonly schemes: SchemeOfWorkService,
    private readonly delivery: LessonDeliveryService,
    private readonly workspace: TeachingWorkspaceService,
  ) {}

  // ── My courses ──
  @Get('my-courses')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  myCourses(@Query('teacherPartnerId') teacherPartnerId?: string, @Query('termId') termId?: string) {
    return this.workspace.myCourses(teacherPartnerId, termId);
  }

  // ── Workspace tabs ──
  @Get('offerings/:id/overview')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  overview(@Param('id') id: string) {
    return this.workspace.overview(id);
  }

  @Get('offerings/:id/coverage')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  coverage(@Param('id') id: string) {
    return this.workspace.coverage(id);
  }

  @Get('offerings/:id/learners')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  learners(@Param('id') id: string) {
    return this.workspace.learners(id);
  }

  @Get('offerings/:id/assessments')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  assessments(@Param('id') id: string) {
    return this.workspace.assessments(id);
  }

  @Get('offerings/:id/outcomes')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  outcomeOptions(@Param('id') id: string) {
    return this.workspace.outcomeOptions(id);
  }

  // ── Learning resources through the offering ──
  @Get('offerings/:id/resources')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  resources(@Param('id') id: string) {
    return this.workspace.resources(id);
  }

  @Post('offerings/:id/resources')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  attachResource(@Param('id') id: string, @Body() dto: AttachOfferingResourceDto) {
    return this.workspace.attachResource(id, dto);
  }

  @Delete('offerings/:id/resources/:resourceId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  detachResource(@Param('id') id: string, @Param('resourceId') resourceId: string) {
    return this.workspace.detachResource(id, resourceId);
  }

  // ── Scheme of work ──
  @Get('offerings/:id/scheme')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  scheme(@Param('id') id: string) {
    return this.schemes.forOffering(id);
  }

  @Post('schemes')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  createScheme(@Body() dto: CreateSchemeOfWorkDto) {
    return this.schemes.create(dto);
  }

  @Patch('schemes/:id')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  updateScheme(@Param('id') id: string, @Body() dto: UpdateSchemeOfWorkDto) {
    return this.schemes.update(id, dto);
  }

  @Post('schemes/:id/weeks')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  addWeek(@Param('id') id: string, @Body() dto: UpsertSchemeWeekDto) {
    return this.schemes.addWeek(id, dto);
  }

  @Patch('scheme-weeks/:weekId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  updateWeek(@Param('weekId') weekId: string, @Body() dto: UpsertSchemeWeekDto) {
    return this.schemes.updateWeek(weekId, dto);
  }

  @Delete('scheme-weeks/:weekId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  removeWeek(@Param('weekId') weekId: string) {
    return this.schemes.removeWeek(weekId);
  }

  @Post('scheme-weeks/:weekId/items')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  addItem(@Param('weekId') weekId: string, @Body() dto: SchemeItemDto) {
    return this.schemes.addItem(weekId, dto);
  }

  @Patch('scheme-items/:itemId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  updateItem(@Param('itemId') itemId: string, @Body() dto: SchemeItemDto) {
    return this.schemes.updateItem(itemId, dto);
  }

  @Delete('scheme-items/:itemId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  removeItem(@Param('itemId') itemId: string) {
    return this.schemes.removeItem(itemId);
  }

  // ── Weekly teaching view and delivery ──
  @Get('week')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  week(@Query('courseOfferingId') courseOfferingId: string, @Query('weekStart') weekStart?: string) {
    return this.delivery.week(courseOfferingId, weekStart);
  }

  @Post('week/generate')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  generateWeek(@Body() dto: GenerateWeekDto) {
    return this.delivery.generateWeek(dto);
  }

  @Get('lessons/:id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  lesson(@Param('id') id: string) {
    return this.delivery.getLesson(id);
  }

  @Patch('lessons/:id')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  updateLesson(@Param('id') id: string, @Body() dto: AttachLessonPlanDto) {
    return this.delivery.updateLesson(id, dto);
  }

  @Post('lessons/:id/deliver')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  deliver(@Param('id') id: string, @Body() dto: DeliverLessonDto) {
    return this.delivery.deliver(id, dto);
  }

  @Post('lessons/:id/reflect')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  reflect(@Param('id') id: string, @Body() dto: ReflectLessonDto) {
    return this.delivery.reflect(id, dto);
  }

  @Get('lessons/:id/attendance')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  attendance(@Param('id') id: string) {
    return this.delivery.attendanceFor(id);
  }

  @Post('lessons/:id/evidence')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  addEvidence(@Param('id') id: string, @Body() dto: AddEvidenceDto) {
    return this.delivery.addEvidence(id, dto);
  }

  @Delete('evidence/:evidenceId')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  removeEvidence(@Param('evidenceId') evidenceId: string) {
    return this.delivery.removeEvidence(evidenceId);
  }

  // ── Remedial follow-up ──
  @Get('follow-ups')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  followUps(@Query() q: { courseOfferingId?: string; status?: string; studentProfileId?: string }) {
    return this.delivery.listFollowUps(q);
  }

  @Post('follow-ups')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  createFollowUp(@Body() dto: CreateFollowUpDto) {
    return this.delivery.createFollowUp(dto);
  }

  @Patch('follow-ups/:id')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  updateFollowUp(@Param('id') id: string, @Body() dto: UpdateFollowUpDto) {
    return this.delivery.updateFollowUp(id, dto);
  }

  // ── Plan ↔ curriculum links ──
  @Post('lesson-plans/:id/outcomes')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  setPlanOutcomes(@Param('id') id: string, @Body() dto: SetPlanOutcomesDto) {
    return this.workspace.setPlanOutcomes(id, dto.learningOutcomeIds);
  }

  @Post('lesson-plans/:id/scheme-week')
  @RequirePermissions(PERMISSIONS.school.ownLessonPlans)
  setPlanSchemeWeek(@Param('id') id: string, @Body() dto: SetPlanSchemeWeekDto) {
    return this.workspace.setPlanSchemeWeek(id, dto.schemeOfWorkWeekId);
  }
}
