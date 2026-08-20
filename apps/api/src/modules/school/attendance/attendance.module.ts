import { Module } from '@nestjs/common';
import { StudentAttendanceService } from './student-attendance.service';
import { AttendanceStatusConfigService } from './attendance-status-config.service';
import { StudentAttendanceController } from './student-attendance.controller';
import { AttendanceNotificationsSubscriber } from './attendance-notifications.subscriber';
import { NotificationsModule } from '../../../kernel/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [StudentAttendanceController],
  providers: [StudentAttendanceService, AttendanceStatusConfigService, AttendanceNotificationsSubscriber],
  exports: [StudentAttendanceService, AttendanceStatusConfigService],
})
export class AttendanceModule {}
