import { Module } from '@nestjs/common';
import { PlacementLookupService } from './placement-lookup.service';

/**
 * `PlacementLookupService`, on its own.
 *
 * Deliberately separate from `EnrollmentModule`, and deliberately thin.
 *
 * The readers being converted away from `StudentProfile.currentClassId` live in
 * fees, meals, statutory, assessment, examinations, reporting, portals and
 * communication. Importing `EnrollmentModule` into all of those would pull in
 * `PlacementService`, `StudentEnrollmentService` and their dependencies —
 * including `AssessmentModule`, which already imports back toward several of
 * them. That is a dependency cycle waiting to happen, and Nest reports those as
 * an unrelated provider being undefined at runtime.
 *
 * This module depends on nothing but `PrismaService`, which `KernelModule`
 * provides globally, so importing it anywhere costs nothing.
 *
 * It is deliberately NOT `@Global`. A global module only supplies its exports
 * once something has actually instantiated it, and the integration specs build
 * narrow TestingModules — `school-fees-integrity` imports `FeesModule` alone,
 * without `SchoolModule`. Under `@Global` that spec failed with
 * PlacementLookupService undefined at index [9], which reads as an unrelated
 * bug. An explicit import in each consuming module fails loudly at the right
 * place instead.
 */
@Module({
  providers: [PlacementLookupService],
  exports: [PlacementLookupService],
})
export class PlacementLookupModule {}
