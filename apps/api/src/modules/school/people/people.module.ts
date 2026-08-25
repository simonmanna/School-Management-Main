import { Module } from '@nestjs/common';
import { StudentService } from './student.service';
import { StudentController } from './student.controller';
import { GuardianService } from './guardian.service';
import { GuardianController } from './guardian.controller';
import { MedicalRecordService } from './medical-record.service';
import { StudentDocumentService } from './student-document.service';
import { MedicalRecordController, StudentDocumentController } from './medical-document.controller';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { PositionService } from './position.service';
import { PositionController } from './position.controller';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { PromotionService } from './promotion.service';
import { PromotionController } from './promotion.controller';
import { EnrollmentService } from './enrollment.service';
import { EnrollmentController } from './enrollment.controller';
import { FeesModule } from '../fees/fees.module';

@Module({
  // D1: the fee statement must read the ONE canonical fee calculation
  // (SchoolFinanceQueryService), not compute a balance of its own — that
  // divergence is exactly how it came to report waivers as money paid.
  imports: [FeesModule],
  controllers: [
    StudentController,
    GuardianController,
    MedicalRecordController,
    StudentDocumentController,
    StaffController,
    PositionController,
    StaffAttendanceController,
    PromotionController,
    EnrollmentController,
  ],
  providers: [
    StudentService,
    GuardianService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
    PromotionService,
    EnrollmentService,
  ],
  exports: [
    StudentService,
    GuardianService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
    PromotionService,
    EnrollmentService,
  ],
})
export class PeopleModule {}