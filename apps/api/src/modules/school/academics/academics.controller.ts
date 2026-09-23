import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { RequireOwnerOrPermission } from '../../../kernel/auth/guards/require-owner-or-permission.decorator';
import {
  CurriculumService,
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

@Controller('school/teacher-assignments')
export class TeacherAssignmentController {
  constructor(
    private readonly service: TeacherAssignmentService,
    private readonly identity: EmployeeIdentityService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  /** A colleague's teaching load is not public: admin, or the teacher themselves. */
  @Get('by-teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  async byTeacher(@Param('teacherPartnerId') id: string) {
    await this.identity.assertIsTeacherOrAdmin(id, PERMISSIONS.school.manageStaff);
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
  constructor(
    private readonly service: TimetableService,
    private readonly identity: EmployeeIdentityService,
  ) {}

  @Get('class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  gridForClass(@Param('classId') classId: string, @Query('sectionId') sectionId?: string, @Query('cycle') cycle?: string) {
    return this.service.gridForClass(classId, sectionId, cycle);
  }

  /** Every recorded version of a class/section grid, newest first (optionally for one term). */
  @Get('class/:classId/history')
  @RequirePermissions(PERMISSIONS.school.read)
  history(@Param('classId') classId: string, @Query('sectionId') sectionId?: string, @Query('termId') termId?: string) {
    return this.service.history(classId, sectionId, termId);
  }

  /** The grid as it stood at a moment (`at`, ISO date). */
  @Get('class/:classId/as-of')
  @RequirePermissions(PERMISSIONS.school.read)
  asOf(@Param('classId') classId: string, @Query('at') at: string, @Query('sectionId') sectionId?: string) {
    const when = new Date(at);
    if (!at || Number.isNaN(when.getTime())) throw new BadRequestException('`at` must be an ISO date.');
    return this.service.asOf(classId, sectionId, when);
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

  @Get('teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  async gridForTeacher(@Param('teacherPartnerId') teacherPartnerId: string, @Query('cycle') cycle?: string) {
    await this.identity.assertIsTeacherOrAdmin(teacherPartnerId, PERMISSIONS.school.manageFoundation);
    return this.service.gridForTeacher(teacherPartnerId, cycle);
  }

  @Get('room/:room')
  @RequirePermissions(PERMISSIONS.school.read)
  gridForRoom(@Param('room') room: string, @Query('cycle') cycle?: string) {
    return this.service.gridForRoom(decodeURIComponent(room), cycle);
  }

  @Get('subject/:subjectId')
  @RequirePermissions(PERMISSIONS.school.read)
  gridForSubject(@Param('subjectId') subjectId: string, @Query('cycle') cycle?: string) {
    return this.service.gridForSubject(subjectId, cycle);
  }

  @Post('class/:classId/publish')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  publishClass(
    @Param('classId') classId: string,
    @Query('sectionId') sectionId: string | undefined,
    @Body() body: { published?: boolean },
  ) {
    return this.service.publishClass(classId, sectionId, body?.published ?? true);
  }
}