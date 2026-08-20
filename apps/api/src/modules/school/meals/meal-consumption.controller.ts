/** Meals — per-student (per-lunch) consumption controller. */
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealConsumptionService } from './meal-consumption.service';
import { RecordMealConsumptionDto, MealConsumptionQueryDto } from './dto.types';

@Controller('school/meals/consumption')
export class MealConsumptionController {
  constructor(private readonly service: MealConsumptionService) {}

  @Post('record')
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  record(@Body() dto: RecordMealConsumptionDto) {
    return this.service.record(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: MealConsumptionQueryDto) {
    return this.service.list(q);
  }
}
