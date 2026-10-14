import { Module } from '@nestjs/common';
import { FrontDeskService } from './front-desk.service';
import { FrontDeskController } from './front-desk.controller';
import { PhoneCallService } from './phone-call.service';
import { PhoneCallController } from './phone-call.controller';
import { ComplaintService } from './complaint.service';
import { ComplaintController } from './complaint.controller';
import { FrontDeskReportService } from './front-desk-report.service';
import { FrontDeskReportController } from './front-desk-report.controller';

@Module({
  controllers: [FrontDeskController, PhoneCallController, ComplaintController, FrontDeskReportController],
  providers: [FrontDeskService, PhoneCallService, ComplaintService, FrontDeskReportService],
  exports: [FrontDeskService, PhoneCallService, ComplaintService],
})
export class FrontDeskModule {}
