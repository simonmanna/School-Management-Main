import { Body, Controller, Get, Patch } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { SchoolService } from './school.service';

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
  updateProfile(@Body() body: Record<string, unknown>) {
    return this.school.updateProfile(body as any);
  }
}