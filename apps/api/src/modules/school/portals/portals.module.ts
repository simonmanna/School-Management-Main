import { Module } from '@nestjs/common';
import { PortalsService } from './portals.service';
import { PortalsController } from './portals.controller';
import { PortalAccountService } from './portal-account.service';
import { PortalAccountController } from './portal-account.controller';
import { PortalDocumentsService } from './portal-documents.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExaminationsModule } from '../examinations/examinations.module';
import { FeesModule } from '../fees/fees.module';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';

@Module({
// D1: the fee statement and the parent portal must read the ONE canonical
// fee calculation (SchoolFinanceQueryService), not compute a balance of
// their own — that divergence is exactly how they came to report waivers
// as money paid.
  // ExaminationsModule for ReportCardPdfService: the portal serves the SAME
  // generator the office prints from, so a family's copy cannot drift from
  // the school's.
  imports: [PlacementLookupModule, AttendanceModule, FeesModule, ExaminationsModule],
  controllers: [PortalsController, PortalAccountController],
  providers: [PortalsService, PortalAccountService, PortalDocumentsService],
  exports: [PortalsService, PortalAccountService, PortalDocumentsService],
})
export class PortalsModule {}