import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import {
  DiscountService,
  FeeCategoryService,
  FeeScheduleService,
  FeeStructureService,
  InstallmentPlanService,
  PenaltyRuleService,
  PenaltyRunService,
  ScholarshipService,
  StudentFeeAssignmentService,
  StudentOptionalFeeService,
} from './catalog.service';
import type { FeeComponent } from './dto.types';
// Value imports (not `import type`): the global ValidationPipe reads
// class-validator metadata off the runtime class, which `import type` erases.
import {
  BulkStudentOptionalFeeDto,
  CreateDiscountDto,
  CreateFeeCategoryDto,
  CreateFeeScheduleDto,
  CreateFeeStructureDto,
  CreateInstallmentPlanDto,
  CreatePenaltyRuleDto,
  CreateScholarshipDto,
  CreateStudentFeeAssignmentDto,
  UpdateDiscountDto,
  UpdateFeeCategoryDto,
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  versions(@Param('id') id: string) {
    return this.service.listVersions(id);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  publish(@Param('id') id: string, @Body() dto?: { components?: FeeComponent[] }) {
    // Body is optional: publishing a draft as-is sends none, repricing a
    // published structure sends the new components (P1-A — `update` refuses
    // them once published, so this is the one repricing door).
    return this.service.publish(id, dto);
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('for-term/:termId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  forTerm(@Param('termId') id: string) {
    return this.service.forTerm(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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

/**
 * P3 — Optional Fees. The roster endpoint is a GET so the screen is
 * bookmarkable/refreshable per (term, category, class); the save is one bulk
 * POST so a bursar editing 400 amounts commits them in a single request rather
 * than 400 PATCHes racing each other.
 */
@Controller('school/student-optional-fees')
export class StudentOptionalFeeController {
  constructor(private readonly service: StudentOptionalFeeService) {}

  @Get('roster')
  @RequirePermissions(PERMISSIONS.school.readFees)
  roster(
    @Query('termId') termId: string,
    @Query('feeCategoryId') feeCategoryId: string,
    @Query('classId') classId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.roster({ termId, feeCategoryId, classId, search });
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  bulk(@Body() dto: BulkStudentOptionalFeeDto) {
    return this.service.bulkUpsert(dto);
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('active-for/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  activeFor(@Param('studentProfileId') id: string) {
    return this.service.activeForStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  byStudent(@Param('studentProfileId') id: string) {
    return this.service.byStudent(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
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
  @RequirePermissions(PERMISSIONS.school.readFees)
  list() {
    return this.service.list();
  }

  @Get('by-schedule/:scheduleId')
  @RequirePermissions(PERMISSIONS.school.readFees)
  bySchedule(@Param('scheduleId') id: string) {
    return this.service.bySchedule(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }
}

@Controller('school/fee-categories')
export class FeeCategoryController {
  constructor(private readonly service: FeeCategoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.readFees)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  create(@Body() dto: CreateFeeCategoryDto) {
    return this.service.create(dto as any);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  update(@Param('id') id: string, @Body() dto: UpdateFeeCategoryDto) {
    return this.service.update(id, dto as any);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFees)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}