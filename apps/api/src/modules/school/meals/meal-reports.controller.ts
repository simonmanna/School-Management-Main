import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealReportsService } from './meal-reports.service';

@Controller('school/meals/reports')
export class MealReportsController {
  constructor(private readonly service: MealReportsService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.school.mealReports)
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.summary(from, to);
  }
}
