import { Body, Controller, Delete, Get, GoneException, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AnnouncementService, LearningResourceService } from './lms.service';
import {
  CreateAnnouncementDto,
  CreateLearningResourceDto,
  UpdateAnnouncementDto,
  UpdateLearningResourceDto,
} from './dto.types';

/**
 * Legacy homework and its submissions are retired (audit 2026-09-29 A01).
 *
 * The reads were gated only on `school:read`, so a teacher who could not open a
 * pupil still read that pupil's retained work, score, feedback and attachments.
 * Homework now lives on the Assessment Board, whose reads are scoped per pupil.
 * The rows stay in the database as migration provenance; no route serves them.
 */
const RETIRED = 'Legacy homework is retired. Use the Assessment Board (assessments of kind homework).';

@Controller('school/homework')
export class HomeworkController {
  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list() {
    throw new GoneException(RETIRED);
  }

  @Get('by-class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass() {
    throw new GoneException(RETIRED);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne() {
    throw new GoneException(RETIRED);
  }

  @Get(':id/detail')
  @RequirePermissions(PERMISSIONS.school.read)
  detail() {
    throw new GoneException(RETIRED);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  create() {
    throw new GoneException(RETIRED);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  update() {
    throw new GoneException(RETIRED);
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.submitAssignments)
  submit() {
    throw new GoneException('Use /school/assignments/submit with the migrated canonical assignment id.');
  }

  @Post('grade')
  @RequirePermissions(PERMISSIONS.school.gradeAssignments)
  grade() {
    throw new GoneException('Use the Assessment Board markbook or canonical assignment grading endpoint.');
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  remove() {
    throw new GoneException(RETIRED);
  }
}

@Controller('school/submissions')
export class SubmissionController {
  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list() {
    throw new GoneException(RETIRED);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne() {
    throw new GoneException(RETIRED);
  }
}

@Controller('school/learning-resources')
export class LearningResourceController {
  constructor(private readonly service: LearningResourceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateLearningResourceDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateLearningResourceDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/announcements')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('feed')
  @RequirePermissions(PERMISSIONS.school.read)
  feed(@Query('audience') audience: 'all' | 'parents' | 'students' | 'staff' = 'all', @Query('classId') classId?: string) {
    return this.service.forAudience(audience, classId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.communicate)
  create(@Body() dto: CreateAnnouncementDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.communicate)
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.communicate)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.communicate)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
