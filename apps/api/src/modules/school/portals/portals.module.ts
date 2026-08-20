import { Module } from '@nestjs/common';
import { PortalsService } from './portals.service';
import { PortalsController } from './portals.controller';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [PortalsController],
  providers: [PortalsService],
  exports: [PortalsService],
})
export class PortalsModule {}