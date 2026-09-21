import { Module } from '@nestjs/common';
import { FeesModule } from '../fees/fees.module';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';

/**
 * Dashboard tiles for the four school dashboards.
 *
 * Imports FeesModule for SchoolFinanceQueryService: every money figure on these
 * tiles delegates to the canonical AR identity rather than summing
 * `Document.amountResidual`, which is a cached projection.
 */
@Module({
  imports: [PlacementLookupModule, FeesModule],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
