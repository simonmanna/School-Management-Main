import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto/expense.dto';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@erp/shared';

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.expense.read)
  list() {
    return this.categories.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.expense.read)
  findOne(@Param('id') id: string) {
    return this.categories.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.expense.update)
  create(@Body() dto: CreateExpenseCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.expense.update)
  update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.expense.update)
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
