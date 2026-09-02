import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ExamOperationsService, type ExamLifecycleState } from './exam-operations.service';
import { ExamSessionService } from './exam-session.service';
import { ExamMarkingService } from './exam-marking.service';
import { QuestionPaperCustodyService } from './question-paper-custody.service';
import { MarkerDirectoryService } from './marker-directory.service';
import {
  AllocateScriptsDto,
  ConfigurePaperDto,
  DecideConsiderationDto,
  DrawModerationSampleDto,
  ExamLifecycleActionDto,
  FreezeCandidatesDto,
  RaiseIncidentDto,
  RecordAttendanceDto,
  RecordCustodyDto,
  RecordModerationDto,
  ReconcileScriptDto,
  RequestConsiderationDto,
  ResolveIncidentDto,
  SubmitScriptMarkDto,
  VoidAllocationsDto,
} from './exam-operations.dto';

/**
 * `/school/exam-operations` — the exam office's console (Phase 5).
 *
 * Reads sit on `school:read` so an exam board can be looked at; every act that
 * changes the run of an examination is a named grant. Marking a script is
 * separate from allocating one, holding the papers is separate from both, and
 * an access arrangement is decided by neither.
 */
@Controller('school/exam-operations')
export class ExamOperationsController {
  constructor(
    private readonly ops: ExamOperationsService,
    private readonly session: ExamSessionService,
    private readonly marking: ExamMarkingService,
    private readonly custody: QuestionPaperCustodyService,
    private readonly markers: MarkerDirectoryService,
  ) {}

  // ── console ──
  @Get('markers')
  @RequirePermissions(PERMISSIONS.school.read)
  markerDirectory() {
    return this.markers.list();
  }

  @Get(':examId/overview')
  @RequirePermissions(PERMISSIONS.school.read)
  overview(@Param('examId') examId: string) {
    return this.ops.overview(examId);
  }

  @Get(':examId/gate')
  @RequirePermissions(PERMISSIONS.school.read)
  gate(@Param('examId') examId: string, @Query('target') target: string) {
    return this.ops.gate(examId, target as ExamLifecycleState);
  }

  @Post(':examId/lifecycle')
  @RequirePermissions(PERMISSIONS.school.runExamOperations)
  transition(@Param('examId') examId: string, @Body() dto: ExamLifecycleActionDto) {
    return this.ops.transition(examId, dto);
  }

  // ── candidates ──
  @Post(':examId/candidates/freeze')
  @RequirePermissions(PERMISSIONS.school.runExamOperations)
  freeze(@Param('examId') examId: string, @Body() dto: FreezeCandidatesDto) {
    return this.ops.freezeCandidates(examId, dto);
  }

  @Get('snapshots/:snapshotId')
  @RequirePermissions(PERMISSIONS.school.read)
  snapshot(@Param('snapshotId') snapshotId: string) {
    return this.ops.snapshot(snapshotId);
  }

  // ── papers ──
  @Post('papers/:examScheduleId/configure')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  configurePaper(@Param('examScheduleId') examScheduleId: string, @Body() dto: ConfigurePaperDto) {
    return this.ops.configurePaper(examScheduleId, dto);
  }

  // ── attendance ──
  @Get('papers/:examScheduleId/register')
  @RequirePermissions(PERMISSIONS.school.read)
  register(@Param('examScheduleId') examScheduleId: string) {
    return this.session.register(examScheduleId);
  }

  @Post('papers/:examScheduleId/register')
  @RequirePermissions(PERMISSIONS.school.runExamOperations)
  recordAttendance(@Param('examScheduleId') examScheduleId: string, @Body() dto: RecordAttendanceDto) {
    return this.session.recordAttendance(examScheduleId, dto);
  }

  // ── incidents ──
  @Get(':examId/incidents')
  @RequirePermissions(PERMISSIONS.school.read)
  incidents(@Param('examId') examId: string) {
    return this.session.incidents(examId);
  }

  @Post('incidents')
  @RequirePermissions(PERMISSIONS.school.runExamOperations)
  raiseIncident(@Body() dto: RaiseIncidentDto) {
    return this.session.raiseIncident(dto);
  }

  /** Closing an incident is a review act, not a hall act. */
  @Post('incidents/:id/resolve')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  resolveIncident(@Param('id') id: string, @Body() dto: ResolveIncidentDto) {
    return this.session.resolveIncident(id, dto);
  }

  // ── special consideration ──
  @Get(':examId/considerations')
  @RequirePermissions(PERMISSIONS.school.read)
  considerations(@Param('examId') examId: string) {
    return this.session.considerations(examId);
  }

  @Post('considerations')
  @RequirePermissions(PERMISSIONS.school.runExamOperations)
  requestConsideration(@Body() dto: RequestConsiderationDto) {
    return this.session.requestConsideration(dto);
  }

  @Post('considerations/:id/decision')
  @RequirePermissions(PERMISSIONS.school.grantSpecialConsideration)
  decideConsideration(@Param('id') id: string, @Body() dto: DecideConsiderationDto) {
    return this.session.decideConsideration(id, dto);
  }

  // ── question-paper custody ──
  @Get(':examId/custody')
  @RequirePermissions(PERMISSIONS.school.read)
  custodyBoard(@Param('examId') examId: string) {
    return this.custody.byExam(examId);
  }

  @Get('question-papers/:questionPaperId/custody')
  @RequirePermissions(PERMISSIONS.school.read)
  custodyChain(@Param('questionPaperId') questionPaperId: string) {
    return this.custody.chain(questionPaperId);
  }

  @Post('question-papers/:questionPaperId/custody')
  @RequirePermissions(PERMISSIONS.school.manageExamCustody)
  recordCustody(@Param('questionPaperId') questionPaperId: string, @Body() dto: RecordCustodyDto) {
    return this.custody.record(questionPaperId, dto);
  }

  // ── script marking ──
  @Post('papers/:examScheduleId/scripts/allocate')
  @RequirePermissions(PERMISSIONS.school.allocateScripts)
  allocate(@Param('examScheduleId') examScheduleId: string, @Body() dto: AllocateScriptsDto) {
    return this.marking.allocate(examScheduleId, dto);
  }

  @Post('papers/:examScheduleId/scripts/void')
  @RequirePermissions(PERMISSIONS.school.allocateScripts)
  voidAllocations(@Param('examScheduleId') examScheduleId: string, @Body() dto: VoidAllocationsDto) {
    return this.marking.voidAllocations(examScheduleId, dto.reason);
  }

  /** A marker's own worklist. Blind marking withholds identity here, not in the UI. */
  @Get('papers/:examScheduleId/scripts')
  @RequirePermissions(PERMISSIONS.school.markScripts)
  worklist(@Param('examScheduleId') examScheduleId: string, @Query('markerId') markerId?: string) {
    return this.marking.worklist(examScheduleId, markerId);
  }

  @Post('scripts/:allocationId/mark')
  @RequirePermissions(PERMISSIONS.school.markScripts)
  submitScriptMark(@Param('allocationId') allocationId: string, @Body() dto: SubmitScriptMarkDto) {
    return this.marking.submitScriptMark(allocationId, dto);
  }

  @Get('papers/:examScheduleId/reconciliation')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  reconciliationBoard(@Param('examScheduleId') examScheduleId: string) {
    return this.marking.reconciliationBoard(examScheduleId);
  }

  @Post('papers/:examScheduleId/reconciliation')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  reconcile(@Param('examScheduleId') examScheduleId: string, @Body() dto: ReconcileScriptDto) {
    return this.marking.reconcile(examScheduleId, dto);
  }

  // ── moderation ──
  @Get('papers/:examScheduleId/moderation')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  samples(@Param('examScheduleId') examScheduleId: string) {
    return this.marking.samples(examScheduleId);
  }

  @Post('papers/:examScheduleId/moderation')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  drawSample(@Param('examScheduleId') examScheduleId: string, @Body() dto: DrawModerationSampleDto) {
    return this.marking.drawSample(examScheduleId, dto);
  }

  @Get('moderation/:sampleId')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  sample(@Param('sampleId') sampleId: string) {
    return this.marking.sample(sampleId);
  }

  @Post('moderation/:sampleId/record')
  @RequirePermissions(PERMISSIONS.school.moderateMarks)
  recordModeration(@Param('sampleId') sampleId: string, @Body() dto: RecordModerationDto) {
    return this.marking.recordModeration(sampleId, dto);
  }
}
