import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StaffAttendanceService } from './staff-attendance.service';
import type { MarkStaffAttendanceDto } from './dto.types';

@Controller('school/staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly attendance: StaffAttendanceService) {}

  @Post('mark')
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  mark(@Body() dto: MarkStaffAttendanceDto) {
    return this.attendance.mark(dto);
  }

  @Get('by-date')
  @RequirePermissions(PERMISSIONS.school.read)
  byDate(@Query('date') date: string) {
    return this.attendance.byDate(date);
  }

  @Get('by-staff/:staffProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStaff(
    @Param('staffProfileId') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.attendance.byStaff(id, new Date(from), new Date(to));
  }
}