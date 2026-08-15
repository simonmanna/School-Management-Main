/** Meals V2 — term meal-plan billing controller. */
import { Body, Controller, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealBillingService } from './meal-billing.service';
import { GenerateMealChargesDto } from './dto.types';

@Controller('school/meals/billing')
export class MealBillingController {
  constructor(private readonly service: MealBillingService) {}

  @Post('run')
  @RequirePermissions(PERMISSIONS.school.mealBilling)
  run(@Body() dto: GenerateMealChargesDto) {
    return this.service.generateMealChargesForTerm(dto);
  }
}
