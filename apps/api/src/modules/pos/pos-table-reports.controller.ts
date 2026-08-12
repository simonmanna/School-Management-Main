/**
 * POS Phase T1 — Table / Reservation reports controller.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosTableReportsService } from './pos-table-reports.service';

@ApiTags('pos/reports')
@ApiBearerAuth()
@Controller('pos/reports/tables')
export class PosTableReportsController {
  constructor(private readonly svc: PosTableReportsService) {}

  @Get('utilization')
  @RequirePermissions('tables:view')
  utilization(@Query('date') date: string) {
    return this.svc.utilization(date);
  }

  @Get('revenue')
  @RequirePermissions('tables:view')
  revenue(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.svc.revenue(fromDate, toDate);
  }
}

@ApiTags('pos/reports')
@ApiBearerAuth()
@Controller('pos/reports/reservations')
export class PosReservationReportsController {
  constructor(private readonly svc: PosTableReportsService) {}

  @Get()
  @RequirePermissions('tables:view')
  reservations(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.svc.reservations(fromDate, toDate);
  }
}