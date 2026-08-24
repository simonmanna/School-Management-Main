import { Module } from '@nestjs/common';
import { AssessmentComponentService, AssessmentPolicyService } from './assessment-config.service';
import { AssessmentService } from './assessment.service';
import { MarkingService } from './marking.service';
import { AssessmentProjectionService } from './assessment-projection.service';
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
 * other modules build on — AssessmentProjectionService for the examinations
 * GradeEntry adapter, and the marking/roster services for A3's result spine.
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
    AssessmentProjectionService,
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
    AssessmentProjectionService,
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
