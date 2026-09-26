import { Module } from '@nestjs/common';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';
import { CareLogService } from './care-log.service';
import { PickupService } from './pickup.service';
import { IncidentService } from './incident.service';
import { ImmunisationService } from './immunisation.service';
import {
  CareLogController,
  ChildIncidentController,
  ImmunisationController,
  PickupController,
} from './early-years.controller';

/**
 * Early years — the nursery half of a nursery-and-primary school.
 *
 * A nursery is not a small primary school. What a family pays for is the daily
 * account of their child's day, a guarantee about who may collect them, and a
 * written record when something happens; none of it is derivable from
 * attendance, marks or fees. Its own module because it is optional to a school
 * that has no nursery, and because these tables are among the most sensitive in
 * the system.
 *
 * Class rosters come from `PlacementLookupService`, so a child admitted this
 * morning is on the room's list without anything being synchronized.
 */
@Module({
  imports: [PlacementLookupModule],
  controllers: [CareLogController, PickupController, ChildIncidentController, ImmunisationController],
  providers: [CareLogService, PickupService, IncidentService, ImmunisationService],
  exports: [CareLogService, PickupService, IncidentService, ImmunisationService],
})
export class EarlyYearsModule {}
