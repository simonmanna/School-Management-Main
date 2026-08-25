import { Module } from '@nestjs/common';
import { PortalsService } from './portals.service';
import { PortalsController } from './portals.controller';
import { AttendanceModule } from '../attendance/attendance.module';
import { FeesModule } from '../fees/fees.module';

@Module({
// D1: the fee statement and the parent portal must read the ONE canonical
// fee calculation (SchoolFinanceQueryService), not compute a balance of
// their own — that divergence is exactly how they came to report waivers
// as money paid.
  imports: [AttendanceModule, FeesModule],
  controllers: [PortalsController],
  providers: [PortalsService],
  exports: [PortalsService],
})
export class PortalsModule {}