import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PortalsService } from './portals.service';

@Controller('school/portals')
export class PortalsController {
  constructor(private readonly portals: PortalsService) {}

  @Get('parent/:studentProfileIds')
  @RequirePermissions(PERMISSIONS.school.parentPortal)
  parentDashboard(@Param('studentProfileIds') ids: string) {
    const list = ids.split(',').filter(Boolean);
    return this.portals.parentDashboard(list);
  }

  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.studentPortal)
  studentDashboard(@Param('studentProfileId') id: string) {
    return this.portals.studentDashboard(id);
  }

  @Get('teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.teacherPortal)
  teacherDashboard(@Param('teacherPartnerId') id: string) {
    return this.portals.teacherDashboard(id);
  }

  /** The teacher workspace (P5) — aggregated "what needs doing" for one teacher. */
  @Get('teaching/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  teachingOverview(@Param('teacherPartnerId') id: string) {
    return this.portals.teacherOverview(id);
  }
}