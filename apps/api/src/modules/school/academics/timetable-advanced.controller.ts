import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { TimetableAdvancedService } from './timetable-advanced.service';
import {
  CreateTeachingRoomDto, UpdateTeachingRoomDto, UpsertTeacherAvailabilityDto,
  SetRotationDto, CreateTimetableOverrideDto, GenerateTimetableDto,
} from './timetable-advanced.dto';

@Controller('school/timetable')
export class TimetableAdvancedController {
  constructor(private readonly svc: TimetableAdvancedService) {}

  /* Teaching rooms */
  @Get('rooms')
  @RequirePermissions(PERMISSIONS.school.read)
  listRooms() { return this.svc.listRooms(); }
  @Post('rooms')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  createRoom(@Body() dto: CreateTeachingRoomDto) { return this.svc.createRoom(dto); }
  @Patch('rooms/:id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  updateRoom(@Param('id') id: string, @Body() dto: UpdateTeachingRoomDto) { return this.svc.updateRoom(id, dto); }
  @Delete('rooms/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  removeRoom(@Param('id') id: string) { return this.svc.removeRoom(id); }

  /* Student timetable */
  @Get('student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  gridForStudent(@Param('studentProfileId') id: string, @Query('date') date?: string) {
    return this.svc.gridForStudent(id, date);
  }

  /* Teacher availability */
  @Get('availability/teacher/:teacherPartnerId')
  @RequirePermissions(PERMISSIONS.school.read)
  availability(@Param('teacherPartnerId') id: string) { return this.svc.availabilityForTeacher(id); }
  @Post('availability')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  setAvailability(@Body() dto: UpsertTeacherAvailabilityDto) { return this.svc.setAvailability(dto); }

  /* Rotation */
  @Get('rotation/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  getRotation(@Param('classId') classId: string) { return this.svc.getRotation(classId); }
  @Post('rotation/:classId')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  setRotation(@Param('classId') classId: string, @Body() dto: SetRotationDto) {
    return this.svc.setRotation(classId, dto.activeCycle);
  }

  /* Overrides (temporary changes) */
  @Get('overrides/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  listOverrides(@Param('classId') classId: string, @Query('sectionId') sectionId?: string) {
    return this.svc.listOverrides(classId, sectionId);
  }
  @Post('overrides')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  createOverride(@Body() dto: CreateTimetableOverrideDto) { return this.svc.createOverride(dto); }
  @Delete('overrides/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  removeOverride(@Param('id') id: string) { return this.svc.removeOverride(id); }

  /* Auto-generation */
  @Post('generate')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  generate(@Body() dto: GenerateTimetableDto) { return this.svc.generate(dto); }
}
