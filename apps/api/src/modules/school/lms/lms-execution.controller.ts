import { Body, Controller, Delete, Get, GoneException, Param, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { LmsExecutionService } from './lms-execution.service';

@Controller('school/lp')
export class LmsExecutionController {
  constructor(private readonly svc: LmsExecutionService) {}

  // ── Phase 2: Scheduled lessons / delivery ──
  @Post('scheduled-lessons')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  createScheduledLesson(@Body() dto: any) {
    return this.svc.createScheduledLesson(dto);
  }

  @Get('scheduled-lessons')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listScheduledLessons(@Query() q: any) {
    return this.svc.listScheduledLessons(q);
  }

  @Post('scheduled-lessons/deliver')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  deliver(@Body() dto: any) {
    return this.svc.deliver(dto);
  }

  // ── Phase 3: Discussions ──
  @Post('discussions')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  createDiscussion(@Body() dto: any) {
    return this.svc.createDiscussion(dto);
  }

  @Get('discussions')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  listDiscussions(@Query() q: any) {
    return this.svc.listDiscussions(q);
  }

  @Get('discussions/:id')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  getDiscussion(@Param('id') id: string) {
    return this.svc.getDiscussion(id);
  }

  @Post('discussions/:id/posts')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  addPost(@Param('id') id: string, @Body() dto: any) {
    return this.svc.addPost(id, dto);
  }

  @Delete('discussions/:id')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  deleteDiscussion(@Param('id') id: string) {
    return this.svc.deleteDiscussion(id);
  }

  // ── Phase 3: Homework submit / grade ──
  @Post('homework/submit')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  submitHomework(@Body() dto: any) {
    throw new GoneException('Legacy homework is read-only. Submit through /school/assignments/submit.');
  }

  @Post('homework/grade')
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  gradeHomework(@Body() dto: any) {
    throw new GoneException('Legacy homework is read-only. Grade through the unified Assessment Board.');
  }

  // ── Phase 4: Evidence + mastery ──
  @Post('evidence')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  recordEvidence(@Body() dto: any) {
    return this.svc.recordEvidence(dto);
  }

  @Post('mastery/objective/recompute')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  recomputeObjective(@Body() dto: { studentProfileId: string; learningObjectiveId: string }) {
    return this.svc.recomputeObjective(dto.studentProfileId, dto.learningObjectiveId);
  }

  @Post('mastery/course/recompute')
  @RequirePermissions(PERMISSIONS.school.manageLessonPlans)
  recomputeCourse(@Body() dto: { studentProfileId: string; courseOfferingId: string }) {
    return this.svc.recomputeCourseProgress(dto.studentProfileId, dto.courseOfferingId);
  }

  // ── Phase 5: Reporting ──
  @Get('reporting/objective-mastery')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  objectiveMastery(@Query() q: any) {
    return this.svc.objectiveMastery(q);
  }

  @Get('reporting/course-progress')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  courseProgressList(@Query() q: any) {
    return this.svc.courseProgressList(q);
  }
}
