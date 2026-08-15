/** Meals V3 — kitchen controller: recipes, production, issue, waste. */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealKitchenService } from './meal-kitchen.service';
import {
  CreateMealRecipeDto,
  PlanProductionDto,
  IssueProductionDto,
  RecordWasteDto,
  SetProductionStatusDto,
} from './dto.types';

@Controller('school/meals')
export class MealKitchenController {
  constructor(private readonly service: MealKitchenService) {}

  @Get('recipes')
  @RequirePermissions(PERMISSIONS.school.read)
  listRecipes() {
    return this.service.listRecipes();
  }

  @Post('recipes')
  @RequirePermissions(PERMISSIONS.school.manageKitchen)
  createRecipe(@Body() dto: CreateMealRecipeDto) {
    return this.service.createRecipe(dto);
  }

  @Get('production')
  @RequirePermissions(PERMISSIONS.school.read)
  listPlans(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.listPlans(from, to);
  }

  @Get('production/:id')
  @RequirePermissions(PERMISSIONS.school.read)
  getPlan(@Param('id') id: string) {
    return this.service.getPlan(id);
  }

  @Post('production/plan')
  @RequirePermissions(PERMISSIONS.school.manageKitchen)
  plan(@Body() dto: PlanProductionDto) {
    return this.service.planProduction(dto);
  }

  @Post('production/:id/issue')
  @RequirePermissions(PERMISSIONS.school.manageKitchen)
  issue(@Param('id') id: string, @Body() dto: IssueProductionDto) {
    return this.service.issueProduction(id, dto);
  }

  @Post('production/:id/waste')
  @RequirePermissions(PERMISSIONS.school.manageKitchen)
  waste(@Param('id') id: string, @Body() dto: RecordWasteDto) {
    return this.service.recordWaste(id, dto);
  }

  @Post('production/:id/status')
  @RequirePermissions(PERMISSIONS.school.manageKitchen)
  status(@Param('id') id: string, @Body() dto: SetProductionStatusDto) {
    return this.service.setStatus(id, dto);
  }
}
