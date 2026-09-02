import { Body, Controller, Delete, Get, GoneException, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AnnouncementService, HomeworkService, LearningResourceService, SubmissionService } from './lms.service';
import {
  CreateAnnouncementDto,
  CreateHomeworkDto,
  CreateLearningResourceDto,
  GradeSubmissionDto,
  SubmitHomeworkDto,
  UpdateAnnouncementDto,
  UpdateHomeworkDto,
  UpdateLearningResourceDto,
} from './dto.types';

@Controller('school/homework')
export class HomeworkController {
  constructor(
    private readonly assignments: HomeworkService,
    private readonly submissions: SubmissionService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.assignments.list(q);
  }

  @Get('by-class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Param('classId') id: string) {
    return this.assignments.byClass(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.assignments.findOne(id);
  }

  @Get(':id/detail')
  @RequirePermissions(PERMISSIONS.school.read)
  detail(@Param('id') id: string) {
    return this.assignments.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  create(@Body() dto: CreateHomeworkDto) {
    throw new GoneException('Legacy homework is read-only. Create homework through the Assessment Board.');
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  update(@Param('id') id: string, @Body() dto: UpdateHomeworkDto) {
    throw new GoneException('Legacy homework is read-only. Use the canonical assignment linked to its assessment.');
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.submitAssignments)
  submit(@Body() dto: SubmitHomeworkDto) {
    throw new GoneException('Use /school/assignments/submit with the migrated canonical assignment id.');
  }

  @Post('grade')
  @RequirePermissions(PERMISSIONS.school.gradeAssignments)
  grade(@Body() dto: GradeSubmissionDto) {
    throw new GoneException('Use the Assessment Board markbook or canonical assignment grading endpoint.');
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  remove(@Param('id') id: string) {
    throw new GoneException('Legacy homework is retained as read-only migration provenance.');
  }
}

@Controller('school/submissions')
export class SubmissionController {
  constructor(private readonly submissions: SubmissionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.submissions.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.submissions.findOne(id);
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
