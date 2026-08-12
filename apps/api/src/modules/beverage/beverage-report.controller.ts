import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { BeverageReportService } from './beverage-report.service';
import { RequiresModule } from '../../kernel/module-loader/requires-module.decorator';

function parseRange(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 864e5);
  return { from: fromDate, to: toDate };
}

@RequiresModule('beverage')
@Controller('beverage/reports')
export class BeverageReportController {
  constructor(private readonly reports: BeverageReportService) {}

  @Get('variance')
  @RequirePermissions(PERMISSIONS.beverage.read)
  variance(@Query('locationId') locationId?: string) {
    return this.reports.variance(locationId || undefined);
  }

  @Get('yield')
  @RequirePermissions(PERMISSIONS.beverage.read)
  yieldReport(@Query('from') from?: string, @Query('to') to?: string, @Query('locationId') locationId?: string) {
    const { from: f, to: t } = parseRange(from, to);
    return this.reports.yieldReport(f, t, locationId || undefined);
  }

  @Get('bartender')
  @RequirePermissions(PERMISSIONS.beverage.read)
  bartender(@Query('from') from?: string, @Query('to') to?: string) {
    const { from: f, to: t } = parseRange(from, to);
    return this.reports.bartender(f, t);
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.beverage.read)
  dashboard(@Query('locationId') locationId?: string) {
    return this.reports.dashboard(locationId || undefined);
  }
}
