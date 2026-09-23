import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { SchoolService } from './school.service';
import { UpdateSchoolProfileDto } from './school-profile.dto';
import { NoPermissionRequired } from '../../kernel/auth/decorators/no-permission-required.decorator';

@Controller('school')
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.school.read)
  overview() {
    return this.school.adminOverview();
  }

  @Get('profile')
  @RequirePermissions(PERMISSIONS.school.read)
  profile() {
    return this.school.getOrCreateProfile();
  }

  @Patch('profile')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  updateProfile(@Body() body: UpdateSchoolProfileDto) {
    return this.school.updateProfile(body);
  }

  /** The school's own labels for its structures (e.g. Class Group, Learner). */
  @Get('terminology')
  @NoPermissionRequired('Display labels only; every signed-in user (staff, parent, pupil) renders them')
  terminology() {
    return this.school.terminology();
  }
}