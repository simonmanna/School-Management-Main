import { Module } from '@nestjs/common';
import { StudentAttendanceService } from './student-attendance.service';
import { StudentAttendanceController } from './student-attendance.controller';
import { AttendanceNotificationsSubscriber } from './attendance-notifications.subscriber';
import { NotificationsModule } from '../../../kernel/notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [StudentAttendanceController],
  providers: [StudentAttendanceService, AttendanceNotificationsSubscriber],
  exports: [StudentAttendanceService],
})
export class AttendanceModule {}
