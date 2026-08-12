import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ReportingService } from './reporting.service';

@Controller('school/reports')
export class ReportingController {
  constructor(private readonly reports: ReportingService) {}

  @Get('admin')
  @RequirePermissions(PERMISSIONS.school.read)
  adminDashboard() {
    return this.reports.adminDashboard();
  }

  @Get('academic')
  @RequirePermissions(PERMISSIONS.school.read)
  academicDashboard() {
    return this.reports.academicDashboard();
  }

  @Get('finance')
  @RequirePermissions(PERMISSIONS.school.read)
  financeDashboard() {
    return this.reports.financeDashboard();
  }

  @Get('operational')
  @RequirePermissions(PERMISSIONS.school.read)
  operationalDashboard() {
    return this.reports.operationalDashboard();
  }

  @Get('outstanding-by-class')
  @RequirePermissions(PERMISSIONS.school.read)
  outstandingByClass() {
    return this.reports.outstandingByClass();
  }

  @Get('attendance-today')
  @RequirePermissions(PERMISSIONS.school.read)
  attendanceToday() {
    return this.reports.attendanceToday();
  }

  @Get('top-performers')
  @RequirePermissions(PERMISSIONS.school.read)
  topPerformers(@Query('limit') limit?: string) {
    return this.reports.topPerformers(Number(limit ?? '10'));
  }

  @Get('daily-collections')
  @RequirePermissions(PERMISSIONS.school.read)
  dailyCollections(@Query('days') days?: string) {
    return this.reports.dailyCollections(Number(days ?? '30'));
  }
}