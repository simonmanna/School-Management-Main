import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AcademicLevelService } from './academic-level.service';
import { CreateAcademicLevelDto, UpdateAcademicLevelDto } from './dto.types';

/**
 * Academic levels (ADR-028, brief §4).
 *
 * Writes are gated on `manageProgrammes` rather than `manageFoundation`: a level
 * nominates the default programme for every grade under it, so editing one can
 * change which assessment rules a learner falls under. That is a curriculum
 * decision, not the same grant as renaming a classroom.
 */
@Controller('school/academic-levels')
export class AcademicLevelController {
  constructor(private readonly levels: AcademicLevelService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.levels.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.levels.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  create(@Body() dto: CreateAcademicLevelDto) {
    return this.levels.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  update(@Param('id') id: string, @Body() dto: UpdateAcademicLevelDto) {
    return this.levels.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  remove(@Param('id') id: string) {
    return this.levels.remove(id);
  }
}
