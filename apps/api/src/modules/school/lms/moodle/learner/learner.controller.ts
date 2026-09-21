import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { LearnerService } from './learner.service';

/**
 * "My learning" (L3.1) — the learner-facing surface.
 *
 * Gated on `school:portal:self`, the narrowest grant there is, because the real
 * gate is portal identity: the service derives the subject from the caller's
 * token and refuses to serve a student who is not theirs. There is deliberately
 * no route that takes a bare student id without that check.
 *
 * These used to require `school:read`, which meant a pupil could only reach
 * their own coursework by holding a grant that also opens the full pupil
 * register, every family's fee balance and the marks workspace. The check that
 * matters here never depended on it.
 */
@Controller('school/lms/my')
export class LearnerController {
  constructor(private readonly learner: LearnerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  dashboard(@Query('asStudent') asStudent?: string) {
    return this.learner.dashboard(asStudent);
  }

  @Get('courses')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  courses(@Query('asStudent') asStudent?: string) {
    return this.learner.myCourses(asStudent);
  }

  @Get('due')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  due(@Query('asStudent') asStudent?: string, @Query('days') days?: string) {
    return this.learner.dueSoon(asStudent, days ? Number(days) : 14);
  }

  @Get('grades')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  grades(@Query('asStudent') asStudent?: string) {
    return this.learner.recentGrades(asStudent);
  }

  @Get('badges')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  badges(@Query('asStudent') asStudent?: string) {
    return this.learner.myBadges(asStudent);
  }

  /** Children a guardian may switch between. Empty for a student or staff. */
  @Get('children')
  @RequirePermissions(PERMISSIONS.school.portalSelf)
  children() {
    return this.learner.myChildren();
  }
}
