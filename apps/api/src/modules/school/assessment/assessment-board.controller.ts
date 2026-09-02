import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AssessmentBoardService } from './assessment-board.service';
import { AssessmentWorkflowService } from './assessment-workflow.service';
import {
  AssessmentBoardQuery,
  CreateUnifiedAssessmentDto,
  MarkTransitionDto,
  SaveBoardMarkDto,
  BulkBoardMarksDto,
  AssessmentLifecycleDto,
  ReconcileAssessmentContextDto,
  ReconcileHomeworkDto,
} from './assessment-board.dto';

/**
 * `/school/assessment-board` — the one surface behind the unified Assessments
 * screen.
 *
 * Canonical write surface. Legacy homework and gradebook writes are retired;
 * exam scheduling remains a specialised operation over the same grade store.
 */
@Controller('school/assessment-board')
export class AssessmentBoardController {
  constructor(private readonly service: AssessmentBoardService, private readonly workflow: AssessmentWorkflowService) {}

  @Get('reconciliation')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  reconciliation(@Query('sourceEntity') sourceEntity?: string) { return this.workflow.reconciliation(sourceEntity); }

  @Post(':id/context')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  reconcileContext(@Param('id') id: string, @Body() dto: ReconcileAssessmentContextDto) { return this.workflow.reconcileContext(id, dto); }

  @Post('legacy-homework/:id/reconcile')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  reconcileHomework(@Param('id') id: string, @Body() dto: ReconcileHomeworkDto) { return this.workflow.reconcileHomework(id, dto); }

  @Post('offerings/:id/roster')
  @RequirePermissions(PERMISSIONS.school.read)
  captureRoster(@Param('id') id: string) { return this.workflow.captureRoster(id); }

  @Post(':id/lifecycle')
  @RequirePermissions(PERMISSIONS.school.read)
  lifecycle(@Param('id') id: string, @Body() dto: AssessmentLifecycleDto) { return this.workflow.transition(id, dto); }

  @Post(':id/marks')
  @RequirePermissions(PERMISSIONS.school.read)
  bulkMarks(@Param('id') id: string, @Body() dto: BulkBoardMarksDto, @Headers('idempotency-key') key: string) { return this.workflow.saveBulk(id, dto, key); }

  @Get(':id/inbox')
  @RequirePermissions(PERMISSIONS.school.read)
  inbox(@Param('id') id: string) { return this.workflow.inbox(id); }

  @Get(':id/evidence/:studentId')
  @RequirePermissions(PERMISSIONS.school.read)
  evidence(@Param('id') id: string, @Param('studentId') studentId: string) { return this.workflow.evidence(id, studentId); }

  /** The list: rows + progress + rolled-up status + the weighting policy. */
  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  board(@Query() q: AssessmentBoardQuery) {
    return this.service.board(q);
  }

  /** What is waiting on an approver, with the numbers they decide on. */
  @Get('approvals')
  @RequirePermissions(PERMISSIONS.school.approveGrades)
  approvals(@Query('termId') termId: string, @Query('classId') classId?: string) {
    return this.service.approvalQueue(termId, classId);
  }

  /** The marksheet for one assessment, roster-derived. */
  @Get(':id/sheet')
  @RequirePermissions(PERMISSIONS.school.read)
  sheet(@Param('id') id: string) {
    return this.service.sheet(id);
  }

  /** Save one cell. Goes straight onto the one writer. */
  @Post(':id/mark')
  @RequirePermissions(PERMISSIONS.school.read)
  mark(@Param('id') id: string, @Body() dto: SaveBoardMarkDto) {
    return this.service.saveMark({ ...dto, marks: dto.marks ?? null, assessmentId: id });
  }

  /** Create an assessment of any kind, including its exam or homework tail. */
  @Post()
  @RequirePermissions(PERMISSIONS.school.read)
  create(@Body() dto: CreateUnifiedAssessmentDto) {
    return this.service.createUnified(dto);
  }

  /**
   * Marker sends their marks for approval. Separate route from `/approve` on
   * purpose — they are different privileges, and collapsing them is exactly how
   * a one-person office ends up approving its own marks.
   */
  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.school.read)
  submit(@Param('id') id: string) {
    return this.service.transitionMarks(id, 'submit');
  }

  /** Approver approves or returns. Segregation of duty is enforced underneath. */
  @Post(':id/approval')
  @RequirePermissions(PERMISSIONS.school.approveGrades)
  approval(@Param('id') id: string, @Body() dto: MarkTransitionDto) {
    return this.service.transitionMarks(id, dto.action, dto.reason);
  }
}
