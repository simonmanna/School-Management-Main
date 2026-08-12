import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { GradeLevelService } from './grade-level.service';
import type { CreateGradeLevelDto, UpdateGradeLevelDto } from './dto.types';

@Controller('school/grade-levels')
export class GradeLevelController {
  constructor(private readonly gradeLevels: GradeLevelService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.gradeLevels.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.gradeLevels.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateGradeLevelDto) {
    return this.gradeLevels.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateGradeLevelDto) {
    return this.gradeLevels.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.gradeLevels.remove(id);
  }
}