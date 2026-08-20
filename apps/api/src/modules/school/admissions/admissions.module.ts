import { Module } from '@nestjs/common';
import { AdmissionsService } from './admissions.service';
import { AdmissionsController } from './admissions.controller';
import { AdmissionsConfigService } from './admissions-config.service';
import { AdmissionsCommitteeService } from './admissions-committee.service';
import { AdmissionsAnalyticsService } from './admissions-analytics.service';
import { AdmissionsPortalService } from './admissions-portal.service';
import { AdmissionsConfigController } from './admissions-config.controller';
import { AdmissionsPortalController } from './admissions-portal.controller';
import { AdmissionsNotificationsSubscriber } from './admissions-notifications.subscriber';
import { OfferExpiryWorker } from './offer-expiry.worker';
import { PeopleModule } from '../people/people.module';
import { NotificationsModule } from '../../../kernel/notifications/notifications.module';

@Module({
  imports: [PeopleModule, NotificationsModule],
  controllers: [AdmissionsController, AdmissionsConfigController, AdmissionsPortalController],
  providers: [
    AdmissionsService,
    AdmissionsConfigService,
    AdmissionsCommitteeService,
    AdmissionsAnalyticsService,
    AdmissionsPortalService,
    AdmissionsNotificationsSubscriber,
    OfferExpiryWorker,
  ],
  exports: [AdmissionsService, AdmissionsConfigService],
})
export class AdmissionsModule {}
