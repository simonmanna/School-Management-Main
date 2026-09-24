import { ScopedToClass } from '../../../kernel/auth/guards/scoped-to-class.decorator';
import { Body, Controller, Delete, Get, Param, Post, Put, Patch, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StudentAttendanceService } from './student-attendance.service';
import {
  BulkMarkAttendanceDto,
  CorrectAttendanceDto,
  UpsertAttendanceThresholdDto,
} from './dto.types';
import {
  CreateAttendanceStatusConfigDto,
  UpdateAttendanceStatusConfigDto,
} from './dto.status-config';
import { AttendanceStatusConfigService } from './attendance-status-config.service';

@Controller('school/attendance')
export class StudentAttendanceController {
  constructor(
    private readonly attendance: StudentAttendanceService,
    private readonly statusConfig: AttendanceStatusConfigService,
  ) {}

  /* ── P-att-status: configurable status catalog (CRUD) ── */

  @Get('statuses')
  @RequirePermissions(PERMISSIONS.school.read)
  listStatuses() {
    return this.statusConfig.list();
  }

  @Post('statuses')
  @RequirePermissions(PERMISSIONS.school.manageAttendanceStatuses)
  createStatus(@Body() dto: CreateAttendanceStatusConfigDto) {
    return this.statusConfig.create(dto);
  }

  @Put('statuses/:id')
  @RequirePermissions(PERMISSIONS.school.manageAttendanceStatuses)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateAttendanceStatusConfigDto) {
    return this.statusConfig.update(id, dto);
  }

  @Delete('statuses/:id')
  @RequirePermissions(PERMISSIONS.school.manageAttendanceStatuses)
  deleteStatus(@Param('id') id: string) {
    return this.statusConfig.remove(id);
  }

  /* ── Attendance recording / read ── */

  /**
   * Take a register.
   *
   * Gated on the owner-scoped `school:attendance:own`, so a teacher can mark
   * their own class from home. The org-wide `school:attendance:write` is checked
   * inside `StudentAttendanceService.mark`, which lets a deputy head mark any
   * class and holds everyone else to the classes they actually teach.
   */
  @Post('mark')
  @RequirePermissions(PERMISSIONS.school.ownAttendance)
  mark(@Body() dto: BulkMarkAttendanceDto) {
    return this.attendance.mark(dto);
  }

  @Get('register')
  @ScopedToClass('classId')
  @RequirePermissions(PERMISSIONS.school.read)
  register(@Query('classId') classId: string, @Query('date') date: string, @Query('periodId') periodId?: string) {
    return this.attendance.dailyRegister(classId, date, periodId || undefined);
  }

  @Get('weekly')
  @ScopedToClass('classId')
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

  /** P-att-status: org attendance summary across a date range — powers the
   *  Attendance Report page (cards + per-day status breakdown). */
  @Get('report')
  @ScopedToClass('classId')
  @RequirePermissions(PERMISSIONS.school.read)
  report(
    @Query('classId') classId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.attendance.report(classId, startDate, endDate);
  }

  /** Attendance correction (audit-logged). Own class only, unless org-wide. */
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.ownAttendance)
  correct(@Param('id') id: string, @Body() dto: CorrectAttendanceDto) {
    return this.attendance.correct(id, dto);
  }

  /** P1a: attendance alert thresholds (org default + per-class overrides). */
  @Get('thresholds')
  @RequirePermissions(PERMISSIONS.school.read)
  thresholds(@Query('classId') classId?: string) {
    return this.attendance.getThreshold(classId || null);
  }

  @Put('thresholds')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  upsertThresholds(@Body() dto: UpsertAttendanceThresholdDto) {
    return this.attendance.upsertThreshold(dto);
  }
}
