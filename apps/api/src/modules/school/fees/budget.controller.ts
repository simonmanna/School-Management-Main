import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { BudgetService } from './budget.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto.types';

@Controller('school/finance/budgets')
export class BudgetController {
  constructor(private readonly service: BudgetService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list() {
    return this.service.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateBudgetDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
