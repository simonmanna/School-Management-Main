/** Meals V1 — session + attendance controller. */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealSessionService } from './meal-session.service';
import { OpenMealSessionDto, BulkMarkMealAttendanceDto } from './dto.types';

@Controller('school/meals/sessions')
export class MealSessionController {
  constructor(private readonly service: MealSessionService) {}

  @Get('today')
  @RequirePermissions(PERMISSIONS.school.read)
  today(@Query('date') date?: string) {
    return this.service.todaysMeals(date);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.listSessions(from, to);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string) {
    return this.service.getSession(id);
  }

  @Get(':id/roster')
  @RequirePermissions(PERMISSIONS.school.read)
  roster(@Param('id') id: string) {
    return this.service.roster(id);
  }

  @Post('open')
  @RequirePermissions(PERMISSIONS.school.mealAttendance)
  open(@Body() dto: OpenMealSessionDto) {
    return this.service.openSession(dto);
  }

  @Post(':id/mark')
  @RequirePermissions(PERMISSIONS.school.mealAttendance)
  mark(@Param('id') id: string, @Body() dto: BulkMarkMealAttendanceDto) {
    return this.service.markAttendance(id, dto);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.school.mealAttendance)
  close(@Param('id') id: string) {
    return this.service.closeSession(id);
  }
}
