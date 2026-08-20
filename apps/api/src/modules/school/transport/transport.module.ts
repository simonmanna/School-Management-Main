import { Module } from '@nestjs/common';
import { InvoicingModule } from '../../invoicing/invoicing.module';
import { AccountingModule } from '../../accounting/accounting.module';
import { TransportConfigService } from './transport-config.service';
import { TransportFleetService } from './transport-fleet.service';
import { TransportCrewService } from './transport-crew.service';
import { TransportEnrollmentService } from './transport-enrollment.service';
import { TransportScheduleService } from './transport-schedule.service';
import { TransportTripService } from './transport-trip.service';
import { TransportBoardingService } from './transport-boarding.service';
import { TransportSafetyService } from './transport-safety.service';
import { TransportBillingService } from './transport-billing.service';
import { TransportController } from './transport.controller';
import { TransportTripGeneratorWorker } from './transport-trip-generator.worker';

@Module({
  imports: [InvoicingModule, AccountingModule],
  controllers: [TransportController],
  providers: [
    TransportConfigService,
    TransportFleetService,
    TransportCrewService,
    TransportEnrollmentService,
    TransportScheduleService,
    TransportTripService,
    TransportBoardingService,
    TransportSafetyService,
    TransportBillingService,
    TransportTripGeneratorWorker,
  ],
  exports: [
    TransportConfigService,
    TransportFleetService,
    TransportCrewService,
    TransportEnrollmentService,
    TransportScheduleService,
    TransportTripService,
    TransportBoardingService,
    TransportSafetyService,
    TransportBillingService,
  ],
})
export class TransportModule {}
