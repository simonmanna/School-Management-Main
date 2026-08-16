import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  CurriculumService,
  LessonPlanService,
  TeacherAssignmentService,
  TimetableService,
} from './academics.service';
import {
  BulkTimetableDto,
  CreateCurriculumDto,
  CreateLessonPlanDto,
  CreateTeacherAssignmentDto,
  CreateTimetableSlotDto,
  UpdateCurriculumDto,
  UpdateLessonPlanDto,
  UpdateTeacherAssignmentDto,
  UpdateTimetableSlotDto,
} from './dto.types';

@Controller('school/curricula')
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}

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
  create(@Body() dto: CreateCurriculumDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateCurriculumDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/clone')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  clone(@Param('id') id: string) {
    return this.service.cloneAsNewVersion(id);
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  archive(@Param('id') id: string) {
    return this.service.archive(id);
  }

  @Get('versions/:classId/:academicYearId')
  @RequirePermissions(PERMISSIONS.school.read)
  versions(@Param('classId') classId: string, @Param('academicYearId') academicYearId: string) {
    return this.service.versions(classId, academicYearId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/lesson-plans')
export class LessonPlanController {
  constructor(private readonly service: LessonPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  byTeacher(@Param('teacherPartnerId') id: string) {
    return this.service.byTeacher(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateLessonPlanDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateLessonPlanDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/teacher-assignments')
export class TeacherAssignmentController {
  constructor(private readonly service: TeacherAssignmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  byTeacher(@Param('teacherPartnerId') id: string) {
    return this.service.byTeacher(id);
  }

  @Get('by-class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Param('classId') id: string) {
    return this.service.byClass(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateTeacherAssignmentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateTeacherAssignmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/timetable')
export class TimetableController {
  constructor(private readonly service: TimetableService) {}

  @Get('class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  gridForClass(@Param('classId') classId: string, @Query('sectionId') sectionId?: string) {
    return this.service.gridForClass(classId, sectionId);
  }

  @Post('slots')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  createSlot(@Body() dto: CreateTimetableSlotDto) {
    return this.service.create(dto);
  }

  @Post('slots/bulk')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  bulkUpsert(@Body() dto: BulkTimetableDto) {
    return this.service.bulkUpsert(dto);
  }

  @Patch('slots/:id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  updateSlot(@Param('id') id: string, @Body() dto: UpdateTimetableSlotDto) {
    return this.service.update(id, dto);
  }

  @Post('slots/check-conflicts')
  @RequirePermissions(PERMISSIONS.school.read)
  async checkConflicts(@Body() dto: CreateTimetableSlotDto & { excludeSlotId?: string }) {
    const { excludeSlotId, ...slot } = dto;
    return this.service.detectConflicts(slot, excludeSlotId);
  }

  @Delete('slots/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  removeSlot(@Param('id') id: string) {
    return this.service.remove(id);
  }
}