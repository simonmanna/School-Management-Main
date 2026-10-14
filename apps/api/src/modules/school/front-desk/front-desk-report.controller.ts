import { Controller, Get, Query, ParseEnumPipe, ParseIntPipe } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { CallDirection, CallStatus, ComplaintCategory, ComplaintPriority, ComplaintStatus } from '@prisma/client';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { FrontDeskReportService } from './front-desk-report.service';

enum GroupBy {
  day = 'day',
  week = 'week',
  month = 'month',
}
enum VisitorStatus {
  in = 'in',
  out = 'out',
  expected = 'expected',
}

/**
 * Front-desk analytics: visitors, phone calls and complaints over one date range.
 * Lives on its own path so `reports` never collides with `school/front-desk/:id`.
 */
@Controller('school/front-desk-reports')
export class FrontDeskReportController {
  constructor(private readonly service: FrontDeskReportService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.school.read)
  summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy', new ParseEnumPipe(GroupBy, { optional: true })) groupBy?: GroupBy,
    @Query('tzOffset', new ParseIntPipe({ optional: true })) tzOffset?: number,
    @Query('visitorStatus', new ParseEnumPipe(VisitorStatus, { optional: true })) visitorStatus?: VisitorStatus,
    @Query('direction', new ParseEnumPipe(CallDirection, { optional: true })) direction?: CallDirection,
    @Query('callStatus', new ParseEnumPipe(CallStatus, { optional: true })) callStatus?: CallStatus,
    @Query('category', new ParseEnumPipe(ComplaintCategory, { optional: true })) category?: ComplaintCategory,
    @Query('priority', new ParseEnumPipe(ComplaintPriority, { optional: true })) priority?: ComplaintPriority,
    @Query('complaintStatus', new ParseEnumPipe(ComplaintStatus, { optional: true })) complaintStatus?: ComplaintStatus,
  ) {
    return this.service.summary({ from, to, groupBy, tzOffset, visitorStatus, direction, callStatus, category, priority, complaintStatus });
  }
}
