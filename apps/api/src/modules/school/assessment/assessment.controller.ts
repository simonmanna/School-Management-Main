import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AssessmentComponentService, AssessmentPolicyService } from './assessment-config.service';
import { AssessmentService } from './assessment.service';
import { MarkingService } from './marking.service';
import { AcademicRosterService } from './roster.service';
import { RubricService } from './rubric.service';
import { AssignmentService } from './assignment.service';
import { AssessmentWorkflowService } from './assessment-workflow.service';
import { AssessmentLifecycleDto, CreateUnifiedAssessmentDto } from './assessment-board.dto';
import { ResultRunService } from './result-run.service';
import { ResultIntegrityService } from './result-integrity.service';
import { PromotionDecisionService } from './promotion-decision.service';
import { ApplyPromotionDto, DecidePromotionDto, ProposePromotionsDto } from './promotion-decision.dto';
import { RejectAmendmentDto } from './dto.types';
import {
  AppendAdjustmentDto,
  AssessmentTransitionDto,
  CaptureRosterDto,
  ComputeResultsDto,
  CreateAssessmentComponentDto,
  CreateAssessmentDto,
  CreateAssessmentPolicyDto,
  CreateAssignmentDto,
  CreateRubricDto,
  GradeAssignmentDto,
  MarkingApprovalDto,
  RecordMarkDto,
  RequestAmendmentDto,
  RosterMemberDto,
  SetParticipationDto,
  SubmitAssignmentDto,
  UpdateAssessmentComponentDto,
  UpdateAssessmentDto,
  UpdateAssessmentPolicyDto,
} from './dto.types';

@Controller('school/assessment-policies')
export class AssessmentPolicyController {
  constructor(private readonly service: AssessmentPolicyService) {}

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  publish(@Param('id') id: string) { return this.service.publish(id); }

  @Post(':id/fork')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  fork(@Param('id') id: string) { return this.service.fork(id); }

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('resolve')
  @RequirePermissions(PERMISSIONS.school.read)
  resolve(
    @Query('subjectId') subjectId?: string,
    @Query('classId') classId?: string,
    @Query('gradeLevelId') gradeLevelId?: string,
    @Query('termId') termId?: string,
  ) {
    return this.service.resolve({ subjectId, classId, gradeLevelId, termId });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  create(@Body() dto: CreateAssessmentPolicyDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  update(@Param('id') id: string, @Body() dto: UpdateAssessmentPolicyDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/assessment-components')
export class AssessmentComponentController {
  constructor(private readonly service: AssessmentComponentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-policy/:policyId')
  @RequirePermissions(PERMISSIONS.school.read)
  byPolicy(@Param('policyId') policyId: string) {
    return this.service.byPolicy(policyId);
  }

  @Get('validate/:policyId')
  @RequirePermissions(PERMISSIONS.school.read)
  validate(@Param('policyId') policyId: string) {
    return this.service.validateWeights(policyId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  create(@Body() dto: CreateAssessmentComponentDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  update(@Param('id') id: string, @Body() dto: UpdateAssessmentComponentDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/assessments')
export class AssessmentController {
  constructor(private readonly service: AssessmentService, private readonly workflow: AssessmentWorkflowService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get('by-class/:classId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClassTerm(@Param('classId') classId: string, @Param('termId') termId: string) {
    return this.service.byClassTerm(classId, termId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  async create(@Body() dto: CreateUnifiedAssessmentDto) {
    return (await this.workflow.create(dto)).assessment;
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  update(@Param('id') id: string, @Body() dto: UpdateAssessmentDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/transition')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  transition(@Param('id') id: string, @Body() dto: AssessmentLifecycleDto) {
    return this.workflow.transition(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/marking')
export class MarkingController {
  constructor(private readonly service: MarkingService) {}

  @Get('by-assessment/:assessmentId')
  @RequirePermissions(PERMISSIONS.school.read)
  byAssessment(@Param('assessmentId') assessmentId: string) {
    return this.service.byAssessment(assessmentId);
  }

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  byStudent(@Param('studentProfileId') studentProfileId: string, @Query('termId') termId?: string) {
    return this.service.byStudent(studentProfileId, termId);
  }

  @Post('participation')
  @RequirePermissions(PERMISSIONS.school.ownGrades)
  participation(@Body() dto: SetParticipationDto) {
    return this.service.setParticipation(dto);
  }

  /**
   * Enter one mark.
   *
   * Gated on the owner-scoped `school:grades:own`, so a teacher can mark their
   * own papers from home. `MarkingService` lets the org-wide
   * `school:grades:write` through unchanged and holds everyone else to the
   * assessments they own. Approval remains a separate grant on a separate route.
   */
  @Post('mark')
  @RequirePermissions(PERMISSIONS.school.ownGrades)
  mark(@Body() dto: RecordMarkDto) {
    return this.service.recordMark(dto);
  }

  @Post('adjustment')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  adjustment(@Body() dto: AppendAdjustmentDto) {
    return this.service.appendAdjustment(dto);
  }

  /** Marker submits their marks for approval. */
  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.ownGrades)
  submit(@Body() dto: { assessmentId: string }) {
    return this.service.markingApproval({ assessmentId: dto.assessmentId, action: 'submit' });
  }

  /** Approver approves or rejects submitted marks (separate privilege; SoD enforced). */
  @Post('approval')
  @RequirePermissions(PERMISSIONS.school.approveGrades)
  approval(@Body() dto: MarkingApprovalDto) {
    return this.service.markingApproval(dto);
  }
}

@Controller('school/rosters')
export class AcademicRosterController {
  constructor(
    private readonly service: AcademicRosterService,
    private readonly dataScope: DataScopeService,
  ) {}

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

  @Get(':id/members')
  @RequirePermissions(PERMISSIONS.school.read)
  async members(@Param('id') id: string) {
    // F09: a teacher reads only the members they may read.
    const rows = await this.service.members(id);
    const visible = await this.dataScope.visibleStudentIds(rows.map((r: any) => r.studentProfileId));
    return visible === 'all' ? rows : rows.filter((r: any) => visible.has(r.studentProfileId));
  }

  @Post('capture')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  capture(@Body() dto: CaptureRosterDto) {
    return this.service.capture(dto);
  }

  @Post(':id/members')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  addMember(@Param('id') id: string, @Body() dto: RosterMemberDto) {
    return this.service.addMember(id, dto);
  }

  @Delete(':id/members/:studentProfileId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  removeMember(@Param('id') id: string, @Param('studentProfileId') studentProfileId: string) {
    return this.service.removeMember(id, studentProfileId);
  }

  @Post(':id/freeze')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  freeze(@Param('id') id: string) {
    return this.service.freeze(id);
  }
}

@Controller('school/rubrics')
export class RubricController {
  constructor(private readonly service: RubricService) {}

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
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  create(@Body() dto: CreateRubricDto) {
    return this.service.createFull(dto);
  }

  @Post(':id/fork')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  fork(@Param('id') id: string) {
    return this.service.fork(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/assignments')
export class AssignmentController {
  constructor(private readonly service: AssignmentService, private readonly workflow: AssessmentWorkflowService) {}

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  byId(@Param('id') id: string) {
    return this.service.byId(id);
  }

  @Get('by-class/:classId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClassTerm(@Param('classId') classId: string, @Param('termId') termId: string) {
    return this.service.byClassTerm(classId, termId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  async create(@Body() dto: CreateUnifiedAssessmentDto) {
    const result = await this.workflow.create({ ...dto, kind: dto.kind ?? 'assignment' });
    return this.service.byAssessment(result.assessment.id);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.manageAssignments)
  async publish(@Param('id') id: string, @Body() dto: AssessmentLifecycleDto) {
    const assignment = await this.service.byId(id);
    if (!assignment) return null;
    return this.workflow.transition(assignment.assessmentId, { ...dto, action: 'publish' });
  }

  @Post('submit')
  @RequirePermissions(PERMISSIONS.school.submitAssignments)
  submit(@Body() dto: SubmitAssignmentDto) {
    return this.service.submitCanonical(dto);
  }

  @Post('record-received')
  @RequirePermissions(PERMISSIONS.school.read)
  recordReceived(@Body() dto: SubmitAssignmentDto) { return this.service.recordReceived(dto); }

  @Post('grade')
  @RequirePermissions(PERMISSIONS.school.read)
  grade(@Body() dto: GradeAssignmentDto) {
    return this.service.gradeCanonical(dto);
  }
}

@Controller('school/results')
export class ResultController {
  constructor(
    private readonly service: ResultRunService,
    private readonly integrity: ResultIntegrityService,
    private readonly dataScope: DataScopeService,
  ) {}

  @Post('compute')
  @RequirePermissions(PERMISSIONS.school.computeResults)
  compute(@Body() dto: ComputeResultsDto) {
    return this.service.compute(dto);
  }

  /**
   * Every result set for a term.
   *
   * Declared BEFORE `:id` — Nest matches routes in declaration order, so a
   * literal segment placed after a parameter segment is unreachable.
   */
  @Get('by-term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  byTerm(@Param('termId') termId: string, @Query('scopeId') scopeId?: string) {
    return this.integrity.byTerm(termId, scopeId);
  }

  @Get('by-student/:studentProfileId/term/:termId')
  @RequirePermissions(PERMISSIONS.school.read)
  async byStudent(@Param('studentProfileId') studentProfileId: string, @Param('termId') termId: string) {
    await this.dataScope.assertMayReadStudent(studentProfileId);
    return this.service.latestPublished(termId, studentProfileId);
  }

  // Results-office views: school-wide, never a class teacher's (F09).
  @Get('amendments/queue')
  @RequirePermissions(PERMISSIONS.school.read)
  async amendmentQueue(@Query('termId') termId?: string) {
    await this.dataScope.assertSchoolWide();
    return this.integrity.amendmentQueue(termId);
  }

  @Get('amendments/by-result-set/:id')
  @RequirePermissions(PERMISSIONS.school.read)
  async amendmentsByResultSet(@Param('id') id: string) {
    await this.dataScope.assertSchoolWide();
    return this.integrity.amendmentsByResultSet(id);
  }

  @Get(':id/readiness')
  @RequirePermissions(PERMISSIONS.school.read)
  async readiness(@Param('id') id: string) {
    await this.dataScope.assertSchoolWide();
    return this.service.readiness(id);
  }

  /** Why this learner's subject percentages are what they are (Phase 5). */
  @Get(':id/explain/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  explain(@Param('id') id: string, @Param('studentProfileId') studentProfileId: string) {
    return this.integrity.explain(id, studentProfileId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string, @Query('studentProfileId') studentProfileId?: string) {
    return this.integrity.detail(id, studentProfileId);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  publish(@Param('id') id: string) {
    return this.service.publish(id);
  }

  @Post(':id/lock')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  lock(@Param('id') id: string) {
    return this.service.lock(id);
  }

  @Post('amendments')
  @RequirePermissions(PERMISSIONS.school.amendResults)
  requestAmendment(@Body() dto: RequestAmendmentDto) {
    return this.service.requestAmendment(dto);
  }

  /** Approving recomputes into a new revision; the old one is archived, not edited. */
  @Post('amendments/:id/approve')
  @RequirePermissions(PERMISSIONS.school.approveResults)
  approveAmendment(@Param('id') id: string) {
    return this.service.approveAmendment(id);
  }

  @Post('amendments/:id/reject')
  @RequirePermissions(PERMISSIONS.school.approveResults)
  rejectAmendment(@Param('id') id: string, @Body() dto: RejectAmendmentDto) {
    return this.integrity.rejectAmendment(id, dto.decisionNote);
  }
}

/**
 * `/school/promotion-decisions` — Phase 5 promotion as three separate acts.
 *
 * Proposing is a computation, deciding is a judgement, and applying moves a
 * child. They are three grants for that reason.
 */
@Controller('school/promotion-decisions')
export class PromotionDecisionController {
  constructor(private readonly service: PromotionDecisionService) {}

  @Get('by-result-set/:resultSetId')
  @RequirePermissions(PERMISSIONS.school.read)
  board(@Param('resultSetId') resultSetId: string) {
    return this.service.board(resultSetId);
  }

  @Post('propose')
  @RequirePermissions(PERMISSIONS.school.computeResults)
  propose(@Body() dto: ProposePromotionsDto) {
    return this.service.propose(dto);
  }

  @Post('decide')
  @RequirePermissions(PERMISSIONS.school.decidePromotion)
  decide(@Body() dto: DecidePromotionDto) {
    return this.service.decide(dto);
  }

  @Post('apply')
  @RequirePermissions(PERMISSIONS.school.applyPromotion)
  apply(@Body() dto: ApplyPromotionDto) {
    return this.service.apply(dto);
  }
}
