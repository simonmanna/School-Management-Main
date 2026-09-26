import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ProgrammeService } from './programme.service';
import { ClassCohortService } from './class-cohort.service';
import { StudentEnrollmentService } from './student-enrollment.service';
import { PlacementService } from './placement.service';
import { PromotionRunService } from './promotion-run.service';
import type { EnrollmentStatusValue } from './enrollment-fsm';
import {
  BulkPlacementDto,
  ChangeEnrollmentStatusDto,
  CreateClassCohortDto,
  CreateProgrammeDto,
  CreateStudentEnrollmentDto,
  GenerateClassCohortsDto,
  MovePlacementDto,
  PromoteEnrollmentDto,
  PromoteStudentDto,
  PromotionRolloverDto,
  RepeatGradeDto,
  SeedUgandaProgrammesDto,
  SuspendEnrollmentDto,
  TermRolloverDto,
  UpdateClassCohortDto,
  UpdateProgrammeDto,
  WithdrawEnrollmentDto,
} from './enrollment.dto';

/* ─────────────────────────── Programmes ─────────────────────────── */

@Controller('school/programmes')
export class ProgrammeController {
  constructor(private readonly service: ProgrammeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.service.list({ includeInactive: includeInactive === 'true' });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  create(@Body() dto: CreateProgrammeDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  update(@Param('id') id: string, @Body() dto: UpdateProgrammeDto) {
    return this.service.update(id, dto);
  }

  /** Install the four Uganda NCDC/UNEB programme templates. Idempotent. */
  @Post('seed-uganda')
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  seedUganda(@Body() dto: SeedUgandaProgrammesDto) {
    return this.service.seedUganda(dto);
  }
}

/* ───────────────────────── Class cohorts ────────────────────────── */

@Controller('school/class-cohorts')
export class ClassCohortController {
  constructor(private readonly service: ClassCohortService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('academicYearId') academicYearId?: string,
    @Query('classId') classId?: string,
    @Query('programmeId') programmeId?: string,
  ) {
    return this.service.list({ academicYearId, classId, programmeId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Whether the cohort is subdivided, and the sections legally available. */
  @Get(':id/grouping-options')
  @RequirePermissions(PERMISSIONS.school.read)
  groupingOptions(@Param('id') id: string) {
    return this.service.groupingOptions(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  create(@Body() dto: CreateClassCohortDto) {
    return this.service.create(dto);
  }

  @Post('generate')
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  generate(@Body() dto: GenerateClassCohortsDto) {
    return this.service.generate(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageProgrammes)
  update(@Param('id') id: string, @Body() dto: UpdateClassCohortDto) {
    return this.service.update(id, dto);
  }
}

/* ────────────────────── Enrollment (membership) ─────────────────── */

// A client that sends Idempotency-Key gets exactly-once writes on retry.
@UseInterceptors(IdempotencyInterceptor)
@Idempotent()
@Controller('school/student-enrollments')
export class StudentEnrollmentController {
  constructor(
    private readonly service: StudentEnrollmentService,
    private readonly placements: PlacementService,
    private readonly dataScope: DataScopeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Re-audit #3 P1-15: enrollment and placement reads skipped data scope, so a
   * class-scoped teacher could read any pupil's history by id. They now follow
   * the same rule as opening the pupil (`DataScopeService.assertMayReadStudent`).
   */
  private async assertMayReadEnrollment(enrollmentId: string) {
    const row = await this.prisma.client.studentEnrollment.findFirst({
      where: { id: enrollmentId },
      select: { studentProfileId: true },
    });
    if (row) await this.dataScope.assertMayReadStudent(row.studentProfileId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(
    @Query('academicYearId') academicYearId?: string,
    @Query('programmeId') programmeId?: string,
    @Query('status') status?: EnrollmentStatusValue,
    @Query('studentProfileId') studentProfileId?: string,
    @Query('classCohortId') classCohortId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list({
      academicYearId,
      programmeId,
      status,
      studentProfileId,
      classCohortId,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  async forStudent(@Param('studentProfileId') studentProfileId: string) {
    await this.dataScope.assertMayReadStudent(studentProfileId);
    return this.service.forStudent(studentProfileId);
  }

  /**
   * Point-in-time placement — the Phase 1 exit gate. Answers "which class was
   * this learner in on this date?" from placement history alone.
   */
  @Get('placement-at/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  async placementAt(@Param('studentProfileId') studentProfileId: string, @Query('at') at?: string) {
    await this.dataScope.assertMayReadStudent(studentProfileId);
    return this.placements.placementAt(studentProfileId, at ? new Date(at) : new Date());
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  async get(@Param('id') id: string) {
    await this.assertMayReadEnrollment(id);
    return this.service.get(id);
  }

  @Get(':id/placements')
  @RequirePermissions(PERMISSIONS.school.read)
  async history(@Param('id') id: string) {
    await this.assertMayReadEnrollment(id);
    return this.placements.history(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  create(@Body() dto: CreateStudentEnrollmentDto) {
    return this.service.create(dto);
  }

  @Post('late-admission')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  lateAdmission(@Body() dto: CreateStudentEnrollmentDto) {
    return this.service.lateAdmission(dto);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  changeStatus(@Param('id') id: string, @Body() dto: ChangeEnrollmentStatusDto) {
    return this.service.changeStatus(id, dto);
  }

  @Post(':id/withdraw')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  withdraw(@Param('id') id: string, @Body() dto: WithdrawEnrollmentDto) {
    return this.service.withdraw(id, dto);
  }

  @Post(':id/transfer-out')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  transferOut(@Param('id') id: string, @Body() dto: WithdrawEnrollmentDto) {
    return this.service.transferOut(id, dto);
  }

  @Post(':id/suspend')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  suspend(@Param('id') id: string, @Body() dto: SuspendEnrollmentDto) {
    return this.service.suspend(id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  complete(@Param('id') id: string, @Body() dto: WithdrawEnrollmentDto) {
    return this.service.complete(id, dto);
  }

  @Post(':id/repeat')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  repeat(@Param('id') id: string, @Body() dto: RepeatGradeDto) {
    return this.service.repeat(id, dto);
  }

  @Post(':id/promote')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  promote(@Param('id') id: string, @Body() dto: PromoteEnrollmentDto) {
    return this.service.promote(id, dto);
  }
}

/* ───────────────────────────── Placement ────────────────────────── */

// A client that sends Idempotency-Key gets exactly-once writes on retry.
@UseInterceptors(IdempotencyInterceptor)
@Idempotent()
@Controller('school/placements')
export class PlacementController {
  constructor(
    private readonly service: PlacementService,
    private readonly dataScope: DataScopeService,
    private readonly prisma: PrismaService,
  ) {}

  /** The class list for a cohort, as it stood at `at` (default: now). */
  @Get('roster/:cohortId')
  @RequirePermissions(PERMISSIONS.school.read)
  async roster(
    @Param('cohortId') cohortId: string,
    @Query('at') at?: string,
    @Query('sectionId') sectionId?: string,
    @Query('termId') termId?: string,
  ) {
    // Re-audit #3 P1-15: a class-scoped teacher lists only classes they teach.
    const cohort = await this.prisma.client.classCohort.findFirst({ where: { id: cohortId }, select: { classId: true } });
    if (cohort) await this.dataScope.assertMayReadClass(cohort.classId);
    return this.service.roster(cohortId, { at: at ? new Date(at) : undefined, sectionId, termId });
  }

  /** Validate a move without writing anything. */
  @Post(':enrollmentId/preview')
  @RequirePermissions(PERMISSIONS.school.read)
  preview(@Param('enrollmentId') enrollmentId: string, @Body() dto: MovePlacementDto) {
    return this.service.preview(enrollmentId, dto);
  }

  @Post(':enrollmentId/move')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  move(@Param('enrollmentId') enrollmentId: string, @Body() dto: MovePlacementDto) {
    return this.service.move(enrollmentId, dto);
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  bulk(@Body() dto: BulkPlacementDto) {
    return this.service.bulkPlace(dto);
  }

  @Post('term-rollover')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  termRollover(@Body() dto: TermRolloverDto) {
    return this.service.termRollover(dto);
  }
}

/* ───────────────────────────── Promotion ────────────────────────── */

/** The promotion board and year-end rollover (student-keyed, next academic year). */
// A client that sends Idempotency-Key gets exactly-once writes on retry.
@UseInterceptors(IdempotencyInterceptor)
@Idempotent()
@Controller('school/promotion')
export class PromotionRunController {
  constructor(private readonly service: PromotionRunService) {}

  @Post('promote')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  promote(@Body() dto: PromoteStudentDto) {
    return this.service.promote(dto);
  }

  /** Dry-run by default; pass `{ "dryRun": false }` to execute. */
  @Post('rollover')
  @RequirePermissions(PERMISSIONS.school.manageEnrollment)
  rollover(@Body() dto: PromotionRolloverDto) {
    return this.service.rollover(dto);
  }
}
