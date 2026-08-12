/**
 * POS Phase A — Reports controller.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosReportsService } from './pos-reports.service';

@ApiTags('pos/reports')
@ApiBearerAuth()
@Controller('pos/reports')
export class PosReportsController {
  constructor(private readonly svc: PosReportsService) {}

  @Get('x-report')
  @RequirePermissions('pos:reports')
  xReport(@Query('cashSessionId') cashSessionId?: string) {
    return this.svc.xReport(cashSessionId);
  }

  @Get('z-report')
  @RequirePermissions('pos:reports')
  zReport(@Query('cashSessionId') cashSessionId?: string) {
    return this.svc.zReport(cashSessionId);
  }

  @Get('z-report/:cashSessionId')
  @RequirePermissions('pos:reports')
  getZReport(@Param('cashSessionId') cashSessionId: string) {
    return this.svc.getZReportSnapshot(cashSessionId);
  }

  @Get('sales-by-hour')
  @RequirePermissions('pos:reports')
  salesByHour(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('hours') hours?: string,
  ) {
    return this.svc.salesByHour(fromDate, toDate, hours);
  }

  @Get('top-items')
  @RequirePermissions('pos:reports')
  topItems(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.topItems(fromDate, toDate, limit ? Number(limit) : 20);
  }

  @Get('sales-summary')
  @RequirePermissions('pos:reports')
  salesSummary(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month',
  ) {
    return this.svc.salesSummary(fromDate, toDate, groupBy);
  }

  @Get('sold-items')
  @RequirePermissions('pos:reports')
  soldItems(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('categoryId') categoryId?: string,
    @Query('waiterId') waiterId?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.svc.soldItems(fromDate, toDate, categoryId, waiterId, orderType);
  }

  @Get('sales-report')
  @RequirePermissions('pos:reports')
  salesReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('waiterId') waiterId?: string,
    @Query('search') search?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.svc.salesReport(fromDate, toDate, waiterId, search, paymentMethod, orderType);
  }

  @Get('order-report')
  @RequirePermissions('pos:reports')
  orderReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('orderType') orderType?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.orderReport(fromDate, toDate, orderType, status);
  }

  @Get('cashier-report')
  @RequirePermissions('pos:reports')
  cashierReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('waiterId') waiterId?: string,
    @Query('search') search?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.svc.cashierReport(fromDate, toDate, waiterId, search, paymentMethod, orderType);
  }

  @Get('cashier-shift-summary')
  @RequirePermissions('pos:reports')
  cashierShiftSummary(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('cashierId') cashierId?: string,
  ) {
    return this.svc.cashierShiftSummary(fromDate, toDate, cashierId);
  }

  @Get('waiter-report')
    @RequirePermissions('pos:reports')
    waiterReport(
      @Query('fromDate') fromDate: string,
      @Query('toDate') toDate: string,
      @Query('waiterId') waiterId?: string,
      @Query('orderType') orderType?: string,
    ) {
      return this.svc.waiterReport(fromDate, toDate, waiterId, orderType);
    }

    @Get('items-by-group')
    @RequirePermissions('pos:reports')
    itemsByGroup(
      @Query('fromDate') fromDate: string,
      @Query('toDate') toDate: string,
      @Query('orderType') orderType?: string,
    ) {
      return this.svc.itemsByGroup(fromDate, toDate, orderType);
    }
  }