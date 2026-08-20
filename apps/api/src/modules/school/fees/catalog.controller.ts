import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  DiscountService,
  FeeScheduleService,
  FeeStructureService,
  InstallmentPlanService,
  PenaltyRuleService,
  PenaltyRunService,
  ScholarshipService,
  StudentFeeAssignmentService,
} from './catalog.service';
// Value imports (not `import type`): the global ValidationPipe reads
// class-validator metadata off the runtime class, which `import type` erases.
import {
  CreateDiscountDto,
  CreateFeeScheduleDto,
  CreateFeeStructureDto,
  CreateInstallmentPlanDto,
  CreatePenaltyRuleDto,
  CreateScholarshipDto,
  CreateStudentFeeAssignmentDto,
  UpdateDiscountDto,
  UpdateFeeScheduleDto,
  UpdateFeeStructureDto,
  UpdateInstallmentPlanDto,
  UpdatePenaltyRuleDto,
  UpdateScholarshipDto,
  UpdateStudentFeeAssignmentDto,
} from './dto.types';

@Controller('school/fee-structures')
export class FeeStructureController {
  constructor(private readonly service: FeeStructureService) {}

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
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateFeeStructureDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateFeeStructureDto) {
    return this.service.update(id, dto);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.school.read)
  versions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/fee-schedules')
export class FeeScheduleController {
  constructor(private readonly service: FeeScheduleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('for-term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  forTerm(@Param('termId') id: string) {
    return this.service.forTerm(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateFeeScheduleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateFeeScheduleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/student-fee-assignments')
export class StudentFeeAssignmentController {
  constructor(private readonly service: StudentFeeAssignmentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateStudentFeeAssignmentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateStudentFeeAssignmentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/discounts')
export class DiscountController {
  constructor(private readonly service: DiscountService) {}

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
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateDiscountDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/scholarships')
export class ScholarshipController {
  constructor(private readonly service: ScholarshipService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('active-for/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  activeFor(@Param('studentProfileId') id: string) {
    return this.service.activeForStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateScholarshipDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateScholarshipDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/installment-plans')
export class InstallmentPlanController {
  constructor(private readonly service: InstallmentPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateInstallmentPlanDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateInstallmentPlanDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/penalty-rules')
export class PenaltyRuleController {
  constructor(private readonly service: PenaltyRuleService) {}

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
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreatePenaltyRuleDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdatePenaltyRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/penalty-runs')
export class PenaltyRunController {
  constructor(private readonly service: PenaltyRunService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list() {
    return this.service.list();
  }

  @Get('by-schedule/:scheduleId')
  @RequirePermissions(PERMISSIONS.school.read)
  bySchedule(@Param('scheduleId') id: string) {
    return this.service.bySchedule(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }
}