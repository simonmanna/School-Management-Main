import { Module } from '@nestjs/common';
import { StudentAttendanceService } from './student-attendance.service';
import { StudentAttendanceController } from './student-attendance.controller';

@Module({
  controllers: [StudentAttendanceController],
  providers: [StudentAttendanceService],
  exports: [StudentAttendanceService],
})
export class AttendanceModule {}