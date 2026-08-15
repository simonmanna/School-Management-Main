/** Meals V1 — config controllers: programs, meal types, entitlements, assignments. */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import {
  MealProgramService,
  MealTypeService,
  MealEntitlementService,
  MealAssignmentService,
} from './meal-config.service';
import {
  CreateMealProgramDto,
  UpdateMealProgramDto,
  CreateMealTypeDto,
  UpdateMealTypeDto,
  SetPlanEntitlementsDto,
  AssignMealPlanDto,
  ChangeAssignmentDto,
} from './dto.types';

@Controller('school/meals/programs')
export class MealProgramController {
  constructor(private readonly service: MealProgramService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) get(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageMeals) create(@Body() dto: CreateMealProgramDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageMeals) update(@Param('id') id: string, @Body() dto: UpdateMealProgramDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageMeals) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/meals/types')
export class MealTypeController {
  constructor(private readonly service: MealTypeService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageMeals) create(@Body() dto: CreateMealTypeDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageMeals) update(@Param('id') id: string, @Body() dto: UpdateMealTypeDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageMeals) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/meals/entitlements')
export class MealEntitlementController {
  constructor(private readonly service: MealEntitlementService) {}
  @Get('by-plan/:planId') @RequirePermissions(PERMISSIONS.school.read) list(@Param('planId') planId: string) { return this.service.list(planId); }
  @Put() @RequirePermissions(PERMISSIONS.school.manageMeals) set(@Body() dto: SetPlanEntitlementsDto) { return this.service.set(dto.mealPlanId, dto.mealTypeIds); }
}

@Controller('school/meals/assignments')
export class MealAssignmentController {
  constructor(private readonly service: MealAssignmentService) {}
  @Post() @RequirePermissions(PERMISSIONS.school.manageMeals) assign(@Body() dto: AssignMealPlanDto) { return this.service.assign(dto); }
  @Post(':id/change') @RequirePermissions(PERMISSIONS.school.manageMeals) change(@Param('id') id: string, @Body() dto: ChangeAssignmentDto) { return this.service.changeStatus(id, dto); }
  @Get('by-student/:studentProfileId') @RequirePermissions(PERMISSIONS.school.read) byStudent(@Param('studentProfileId') id: string) { return this.service.listByStudent(id); }
  @Get('by-term/:termId') @RequirePermissions(PERMISSIONS.school.read) byTerm(@Param('termId') termId: string, @Query('status') status?: string) { return this.service.listByTerm(termId, status); }
}
