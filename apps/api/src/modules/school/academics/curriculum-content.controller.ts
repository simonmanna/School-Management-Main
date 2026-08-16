import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  CompetencyService,
  TopicService,
  UnitService,
  LearningObjectiveService,
} from './curriculum-content.service';
import {
  CreateCompetencyDto,
  CreateTopicDto,
  CreateUnitDto,
  CreateLearningObjectiveDto,
  UpdateCompetencyDto,
  UpdateTopicDto,
  UpdateUnitDto,
  UpdateLearningObjectiveDto,
} from './dto.types';

@Controller('school/competencies')
export class CompetencyController {
  constructor(private readonly service: CompetencyService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageFoundation) create(@Body() dto: CreateCompetencyDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageFoundation) update(@Param('id') id: string, @Body() dto: UpdateCompetencyDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageFoundation) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/topics')
export class TopicController {
  constructor(private readonly service: TopicService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageFoundation) create(@Body() dto: CreateTopicDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageFoundation) update(@Param('id') id: string, @Body() dto: UpdateTopicDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageFoundation) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/units')
export class UnitController {
  constructor(private readonly service: UnitService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageFoundation) create(@Body() dto: CreateUnitDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageFoundation) update(@Param('id') id: string, @Body() dto: UpdateUnitDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageFoundation) remove(@Param('id') id: string) { return this.service.remove(id); }
}

@Controller('school/learning-objectives')
export class LearningObjectiveController {
  constructor(private readonly service: LearningObjectiveService) {}
  @Get() @RequirePermissions(PERMISSIONS.school.read) list(@Query() q: PaginationDto) { return this.service.list(q); }
  @Get(':id') @RequirePermissions(PERMISSIONS.school.read) findOne(@Param('id') id: string) { return this.service.findOne(id); }
  @Post() @RequirePermissions(PERMISSIONS.school.manageFoundation) create(@Body() dto: CreateLearningObjectiveDto) { return this.service.create(dto); }
  @Patch(':id') @RequirePermissions(PERMISSIONS.school.manageFoundation) update(@Param('id') id: string, @Body() dto: UpdateLearningObjectiveDto) { return this.service.update(id, dto); }
  @Delete(':id') @HttpCode(204) @RequirePermissions(PERMISSIONS.school.manageFoundation) remove(@Param('id') id: string) { return this.service.remove(id); }
}
