import { Module } from '@nestjs/common';
import { FrontDeskService } from './front-desk.service';
import { FrontDeskController } from './front-desk.controller';
import { PhoneCallService } from './phone-call.service';
import { PhoneCallController } from './phone-call.controller';
import { ComplaintService } from './complaint.service';
import { ComplaintController } from './complaint.controller';

@Module({
  controllers: [FrontDeskController, PhoneCallController, ComplaintController],
  providers: [FrontDeskService, PhoneCallService, ComplaintService],
  exports: [FrontDeskService, PhoneCallService, ComplaintService],
})
export class FrontDeskModule {}
