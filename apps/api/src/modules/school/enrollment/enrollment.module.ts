import { Module } from '@nestjs/common';
import { ProgrammeService } from './programme.service';
import { ClassCohortService } from './class-cohort.service';
import { PlacementService } from './placement.service';
import { StudentEnrollmentService } from './student-enrollment.service';
import { EnrollmentBackfillService } from './enrollment-backfill.service';
import {
  ClassCohortController,
  EnrollmentMigrationController,
  PlacementController,
  ProgrammeController,
  StreamGroupingController,
  StudentEnrollmentController,
} from './enrollment.controller';

/**
 * Phase 1 — the canonical enrollment and grouping spine (ADR-018 / ADR-019).
 *
 * Deliberately separate from `PeopleModule`: the legacy per-term `Enrollment`
 * lives there and stays a compatibility surface until the Phase 0.5 retirement
 * conditions are met. Keeping the canonical model in its own module makes the
 * boundary visible in the import graph rather than in a comment.
 */
@Module({
  controllers: [
    ProgrammeController,
    ClassCohortController,
    StreamGroupingController,
    StudentEnrollmentController,
    PlacementController,
    EnrollmentMigrationController,
  ],
  providers: [
    ProgrammeService,
    ClassCohortService,
    PlacementService,
    StudentEnrollmentService,
    EnrollmentBackfillService,
  ],
  exports: [ProgrammeService, ClassCohortService, PlacementService, StudentEnrollmentService, EnrollmentBackfillService],
})
export class SchoolEnrollmentModule {}
