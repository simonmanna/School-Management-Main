import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StudentAttendanceService } from './student-attendance.service';
import { BulkMarkAttendanceDto } from './dto.types';

@Controller('school/attendance')
export class StudentAttendanceController {
  constructor(private readonly attendance: StudentAttendanceService) {}

  @Post('mark')
  @RequirePermissions(PERMISSIONS.school.takeAttendance)
  mark(@Body() dto: BulkMarkAttendanceDto) {
    return this.attendance.mark(dto);
  }

  @Get('register')
  @RequirePermissions(PERMISSIONS.school.read)
  register(@Query('classId') classId: string, @Query('date') date: string, @Query('periodId') periodId?: string) {
    return this.attendance.dailyRegister(classId, date, periodId || undefined);
  }

  @Get('weekly')
  @RequirePermissions(PERMISSIONS.school.read)
  weekly(@Query('classId') classId: string, @Query('weekStart') weekStart: string) {
    return this.attendance.weekly(classId, weekStart);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(
    @Param('studentProfileId') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.attendance.byStudent(id, from, to);
  }
}