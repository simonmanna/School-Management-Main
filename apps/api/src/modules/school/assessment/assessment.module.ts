import { Module } from '@nestjs/common';
import { AssessmentComponentService, AssessmentPolicyService } from './assessment-config.service';
import { AssessmentService } from './assessment.service';
import { MarkingService } from './marking.service';
import { AssessmentMintService } from './assessment-mint.service';
import { AssessmentBoardService } from './assessment-board.service';
import { AssessmentBoardController } from './assessment-board.controller';
import { AssessmentWorkflowService } from './assessment-workflow.service';
import { AcademicRosterService } from './roster.service';
import { RubricService } from './rubric.service';
import { AssignmentService } from './assignment.service';
import { ResultRunService } from './result-run.service';
import { ResultIntegrityService } from './result-integrity.service';
import { PromotionDecisionService } from './promotion-decision.service';
import { SchoolEnrollmentModule } from '../enrollment/enrollment.module';
import { CbtResultBridgeService } from './cbt-result-bridge.service';
import { GradebookService } from './gradebook.service';
import { GradebookController } from './gradebook.controller';
import { AcademicReminderWorker } from './academic-reminder.worker';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';
import {
  AcademicRosterController,
  AssessmentComponentController,
  AssessmentController,
  AssessmentPolicyController,
  AssignmentController,
  MarkingController,
  PromotionDecisionController,
  ResultController,
  RubricController,
} from './assessment.controller';

/**
 * Assessment core (A1) + rosters/assignments/rubrics (A2). Exports the services
 * other modules build on — the marking/roster/mint services for A3's result
 * spine. The GradeEntry adapter was retired in B6 (GradeEntry is now read-only).
 * CbtResultBridgeService lets the CBT module post quiz marks into this spine.
 */
@Module({
  // Phase 5 applies a promotion decision through the canonical placement
  // spine rather than writing a placement itself — one writer, not two.
  // PlacementLookupModule: rosters read placement history (ADR-027).
  imports: [SchoolEnrollmentModule, PlacementLookupModule],
  controllers: [
    AssessmentPolicyController,
    AssessmentComponentController,
    AssessmentController,
    MarkingController,
    AcademicRosterController,
    RubricController,
    AssignmentController,
    ResultController,
    GradebookController,
    AssessmentBoardController,
    PromotionDecisionController,
  ],
  providers: [
    // Phase 6 — deadline reminders. Off unless ACADEMIC_REMINDERS_ENABLED=true;
    // registering the provider costs nothing when the flag is unset.
    AcademicReminderWorker,
    AssessmentWorkflowService,
    AssessmentPolicyService,
    AssessmentComponentService,
    AssessmentService,
    MarkingService,
    AssessmentMintService,
    AssessmentBoardService,
    AcademicRosterService,
    RubricService,
    AssignmentService,
    ResultRunService,
    ResultIntegrityService,
    PromotionDecisionService,
    CbtResultBridgeService,
    GradebookService,
  ],
  exports: [
    AssessmentWorkflowService,
    AssessmentPolicyService,
    AssessmentComponentService,
    AssessmentService,
    MarkingService,
    AssessmentMintService,
    AssessmentBoardService,
    AcademicRosterService,
    RubricService,
    AssignmentService,
    ResultRunService,
    ResultIntegrityService,
    PromotionDecisionService,
    CbtResultBridgeService,
    GradebookService,
  ],
})
export class AssessmentModule {}
