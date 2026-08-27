import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { LearnerService } from './learner.service';

/**
 * "My learning" (L3.1) — the learner-facing surface.
 *
 * Gated on `school:read` only, because the real gate is portal identity: the
 * service derives the subject from the caller's token and refuses to serve a
 * student who is not theirs. There is deliberately no route that takes a bare
 * student id without that check.
 */
@Controller('school/lms/my')
export class LearnerController {
  constructor(private readonly learner: LearnerService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  dashboard(@Query('asStudent') asStudent?: string) {
    return this.learner.dashboard(asStudent);
  }

  @Get('courses')
  @RequirePermissions(PERMISSIONS.school.read)
  courses(@Query('asStudent') asStudent?: string) {
    return this.learner.myCourses(asStudent);
  }

  @Get('due')
  @RequirePermissions(PERMISSIONS.school.read)
  due(@Query('asStudent') asStudent?: string, @Query('days') days?: string) {
    return this.learner.dueSoon(asStudent, days ? Number(days) : 14);
  }

  @Get('grades')
  @RequirePermissions(PERMISSIONS.school.read)
  grades(@Query('asStudent') asStudent?: string) {
    return this.learner.recentGrades(asStudent);
  }

  /** Children a guardian may switch between. Empty for a student or staff. */
  @Get('children')
  @RequirePermissions(PERMISSIONS.school.read)
  children() {
    return this.learner.myChildren();
  }
}
