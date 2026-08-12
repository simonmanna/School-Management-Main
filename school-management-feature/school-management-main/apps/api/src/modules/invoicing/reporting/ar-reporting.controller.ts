import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ArReportingService } from './ar-reporting.service';
import { ApAgingService } from './ap-aging.service';

@Controller('reports')
export class ArReportingController {
  constructor(
    private readonly reporting: ArReportingService,
    private readonly apAging: ApAgingService,
  ) {}

  @Get('ar/aging')
  @RequirePermissions(PERMISSIONS.report.ar)
  arAging(@Query('asOf') asOf?: string) {
    return this.reporting.aging(asOf);
  }

  @Get('ar/customer-balances')
  @RequirePermissions(PERMISSIONS.report.ar)
  customerBalances() {
    return this.reporting.customerBalances();
  }

  @Get('ar/outstanding')
  @RequirePermissions(PERMISSIONS.report.ar)
  outstanding() {
    return this.reporting.outstandingInvoices();
  }

  @Get('ar/revenue-by-customer')
  @RequirePermissions(PERMISSIONS.report.ar)
  revenueByCustomer(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.revenueByCustomer({ from, to });
  }

  @Get('ar/revenue-by-period')
  @RequirePermissions(PERMISSIONS.report.ar)
  revenueByPeriod(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reporting.revenueByPeriod({ from, to });
  }

  @Get('ap/aging')
  @RequirePermissions(PERMISSIONS.report.ar)
  apAgingReport(@Query('asOf') asOf?: string) {
    return this.apAging.apAging(asOf);
  }
}
