import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../../../kernel/auth/decorators/require-permissions.decorator';
import { LmsRolesService } from './roles.service';

/** P0 — role seeding, assignment and participant listing (ADR-014 §3.1). */
@Controller('school/lms/roles')
export class LmsRolesController {
  constructor(private readonly svc: LmsRolesService) {}

  /** One-shot: create the 8 archetype roles + default capabilities for this org. */
  @Post('seed')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  seed() {
    return this.svc.seed();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  list() {
    return this.svc.listRoles();
  }

  @Post('assign')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  assign(@Body() dto: { courseOfferingId: string; roleShortname: string; userId?: string; studentProfileId?: string; sourceComponent?: string }) {
    return this.svc.assignAtCourse(dto);
  }

  @Delete('assign/:id')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  unassign(@Param('id') id: string) {
    return this.svc.unassign(id);
  }

  @Get('participants')
  @RequirePermissions(PERMISSIONS.school.lmsRead)
  participants(@Query('courseOfferingId') courseOfferingId: string) {
    return this.svc.participants(courseOfferingId);
  }
}
