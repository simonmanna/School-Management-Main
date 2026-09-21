import { Module } from '@nestjs/common';
import { CandidateReferenceService } from './candidate-reference.service';
import { UnebCaService } from './uneb-ca.service';
import { StatutoryExportService } from './statutory-export.service';
import { StatutoryController } from './statutory.controller';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';

/**
 * Statutory workflows (Phase 6): the candidate-reference registry, the UNEB
 * continuous-assessment readiness board and the configurable export desk.
 *
 * It reads the academic core and writes only its own registry and provenance
 * rows — never a mark, never a result. Everything a school sends to a board is
 * therefore a view of the canonical record rather than a second copy of it.
 */
@Module({
  // PlacementLookupModule: a statutory submission must name the class the
  // learner actually held, not a projection of where they sit today (ADR-027).
  imports: [PlacementLookupModule],
  controllers: [StatutoryController],
  providers: [CandidateReferenceService, UnebCaService, StatutoryExportService],
  exports: [CandidateReferenceService, UnebCaService, StatutoryExportService],
})
export class StatutoryModule {}
