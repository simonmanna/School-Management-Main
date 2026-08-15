/** Meals V1 — menu controller. */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MealMenuService } from './meal-menu.service';
import { CreateMealMenuDto, UpdateMealMenuDto, MealMenuItemInput } from './dto.types';

@Controller('school/meals/menus')
export class MealMenuController {
  constructor(private readonly service: MealMenuService) {}

  @Get('school-catalog')
  @RequirePermissions(PERMISSIONS.school.read)
  schoolCatalog() {
    return this.service.schoolCatalog();
  }

  @Get('pos-catalog')
  @RequirePermissions(PERMISSIONS.school.read)
  posCatalog() {
    return this.service.posCatalog();
  }

  @Post('from-pos')
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  fromPos(@Body() dto: CreateMealMenuDto) {
    return this.service.fromPos(dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query('mealTypeId') mealTypeId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(mealTypeId, from, to);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  create(@Body() dto: CreateMealMenuDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  update(@Param('id') id: string, @Body() dto: UpdateMealMenuDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/items')
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  addItem(@Param('id') id: string, @Body() dto: MealMenuItemInput) {
    return this.service.addItem(id, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  removeItem(@Param('itemId') itemId: string) {
    return this.service.removeItem(itemId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageMeals)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
