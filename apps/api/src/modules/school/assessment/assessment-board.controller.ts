import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AssessmentBoardService } from './assessment-board.service';
import {
  AssessmentBoardQuery,
  CreateUnifiedAssessmentDto,
  MarkTransitionDto,
  SaveBoardMarkDto,
} from './assessment-board.dto';

/**
 * `/school/assessment-board` — the one surface behind the unified Assessments
 * screen.
 *
 * Deliberately additive: the kind-specific controllers (`/school/exams`,
 * `/school/homework`, `/school/gradebook`) still work and still own the deep
 * detail. This is the door a teacher comes in through, not a replacement for
 * the rooms behind it.
 */
@Controller('school/assessment-board')
export class AssessmentBoardController {
  constructor(private readonly service: AssessmentBoardService) {}

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
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  mark(@Param('id') id: string, @Body() dto: SaveBoardMarkDto) {
    return this.service.saveMark({ ...dto, marks: dto.marks ?? null, assessmentId: id });
  }

  /** Create an assessment of any kind, including its exam or homework tail. */
  @Post()
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  create(@Body() dto: CreateUnifiedAssessmentDto) {
    return this.service.createUnified(dto);
  }

  /**
   * Marker sends their marks for approval. Separate route from `/approve` on
   * purpose — they are different privileges, and collapsing them is exactly how
   * a one-person office ends up approving its own marks.
   */
  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
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
