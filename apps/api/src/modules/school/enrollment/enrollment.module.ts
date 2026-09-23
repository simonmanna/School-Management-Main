import { Module } from '@nestjs/common';
import { ProgrammeService } from './programme.service';
import { ClassCohortService } from './class-cohort.service';
import { PlacementService } from './placement.service';
import { StudentEnrollmentService } from './student-enrollment.service';
import { PromotionRunService } from './promotion-run.service';
import { SuspensionExpiryWorker } from './suspension-expiry.worker';
import { PlacementLookupModule } from './placement-lookup.module';
import {
  ClassCohortController,
  PlacementController,
  ProgrammeController,
  PromotionRunController,
  StudentEnrollmentController,
} from './enrollment.controller';

/**
 * The enrollment and grouping spine (ADR-018 / ADR-029): programmes, annual
 * class cohorts, student enrollments and effective-dated placements. The only
 * source of which class and stream a learner is in.
 */
@Module({
  imports: [PlacementLookupModule],
  controllers: [
    ProgrammeController,
    ClassCohortController,
    StudentEnrollmentController,
    PlacementController,
    PromotionRunController,
  ],
  providers: [
    ProgrammeService,
    ClassCohortService,
    PlacementService,
    StudentEnrollmentService,
    PromotionRunService,
    SuspensionExpiryWorker,
  ],
  exports: [ProgrammeService, ClassCohortService, PlacementService, StudentEnrollmentService],
})
export class SchoolEnrollmentModule {}
