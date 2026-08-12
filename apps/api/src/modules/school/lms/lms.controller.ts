import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateHomeworkDto) {
    return this.assignments.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateHomeworkDto) {
    return this.assignments.update(id, dto);
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.read)
  submit(@Body() dto: SubmitHomeworkDto) {
    return this.assignments.submit(dto);
  }

  @Post('grade')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  grade(@Body() dto: GradeSubmissionDto) {
    return this.assignments.grade(dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.assignments.remove(id);
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