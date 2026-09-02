import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CourseOfferingService } from './course-offering.service';
import {
  BulkGenerateOfferingsDto,
  CreateActivityDefinitionDto,
  CreateCourseOfferingDto,
  MigrateTeacherAssignmentsDto,
  RolloverOfferingDto,
  SetCourseEnrollmentDto,
  SyncCourseRosterDto,
  TeacherAllocationDto,
  TransitionCourseOfferingDto,
  UpdateCourseOfferingDto,
} from './course-offering.dto';

@Controller('school/course-offerings')
export class CourseOfferingController {
  constructor(private readonly service: CourseOfferingService) {}

  @Get('definitions/activities')
  @RequirePermissions(PERMISSIONS.school.read)
  activities() { return this.service.activityDefinitions(); }

  @Post('definitions/activities')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  createActivity(@Body() dto: CreateActivityDefinitionDto) { return this.service.createActivityDefinition(dto); }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('academicYearId') academicYearId?: string,
    @Query('termId') termId?: string,
    @Query('programmeId') programmeId?: string,
    @Query('classCohortId') classCohortId?: string,
    @Query('status') status?: string,
    @Query('offeringType') offeringType?: string,
    @Query('search') search?: string,
  ) { return this.service.list({ academicYearId, termId, programmeId, classCohortId, status, offeringType, search }); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string) { return this.service.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  create(@Body() dto: CreateCourseOfferingDto) { return this.service.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  update(@Param('id') id: string, @Body() dto: UpdateCourseOfferingDto) { return this.service.update(id, dto); }

  @Post(':id/transition')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  transition(@Param('id') id: string, @Body() dto: TransitionCourseOfferingDto) { return this.service.transition(id, dto); }

  @Post(':id/teachers')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  allocateTeacher(@Param('id') id: string, @Body() dto: TeacherAllocationDto) { return this.service.allocateTeacher(id, dto); }

  @Delete(':id/teachers/:teacherId')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  endTeacher(@Param('id') id: string, @Param('teacherId') teacherId: string) { return this.service.endTeacherAllocation(id, teacherId); }

  @Get(':id/roster')
  @RequirePermissions(PERMISSIONS.school.read)
  roster(@Param('id') id: string) { return this.service.roster(id); }

  @Post(':id/roster/sync')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  syncRoster(@Param('id') id: string, @Body() dto: SyncCourseRosterDto) { return this.service.syncRoster(id, dto); }

  @Post(':id/enrollments')
  @RequirePermissions(PERMISSIONS.school.enrolLearners)
  setEnrollment(@Param('id') id: string, @Body() dto: SetCourseEnrollmentDto) { return this.service.setEnrollment(id, dto); }

  @Post(':id/rollover')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  rollover(@Param('id') id: string, @Body() dto: RolloverOfferingDto) { return this.service.rollover(id, dto); }

  @Post('actions/bulk-generate')
  @RequirePermissions(PERMISSIONS.school.manageCourses)
  bulkGenerate(@Body() dto: BulkGenerateOfferingsDto) { return this.service.bulkGenerate(dto); }

  @Post('actions/migrate-teacher-assignments')
  @RequirePermissions(PERMISSIONS.school.runAcademicMigration)
  migrate(@Body() dto: MigrateTeacherAssignmentsDto) { return this.service.migrateTeacherAssignments(dto); }
}
