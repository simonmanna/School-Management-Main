import { Module } from '@nestjs/common';
import { AssessmentComponentService, AssessmentPolicyService } from './assessment-config.service';
import { AssessmentService } from './assessment.service';
import { MarkingService } from './marking.service';
import { AssessmentMintService } from './assessment-mint.service';
import { AssessmentBoardService } from './assessment-board.service';
import { AssessmentBoardController } from './assessment-board.controller';
import { AcademicRosterService } from './roster.service';
import { RubricService } from './rubric.service';
import { AssignmentService } from './assignment.service';
import { ResultRunService } from './result-run.service';
import { CbtResultBridgeService } from './cbt-result-bridge.service';
import { GradebookService } from './gradebook.service';
import { GradebookController } from './gradebook.controller';
import {
  AcademicRosterController,
  AssessmentComponentController,
  AssessmentController,
  AssessmentPolicyController,
  AssignmentController,
  MarkingController,
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
  ],
  providers: [
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
    CbtResultBridgeService,
    GradebookService,
  ],
  exports: [
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
    CbtResultBridgeService,
    GradebookService,
  ],
})
export class AssessmentModule {}
