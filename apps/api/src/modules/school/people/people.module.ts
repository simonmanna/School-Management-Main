import { Module } from '@nestjs/common';
import { StudentService } from './student.service';
import { StudentController } from './student.controller';
import { GuardianService } from './guardian.service';
import { GuardianController } from './guardian.controller';
import { EmergencyContactService } from './emergency-contact.service';
import { EmergencyContactController } from './emergency-contact.controller';
import { MedicalRecordService } from './medical-record.service';
import { StudentDocumentService } from './student-document.service';
import { MedicalRecordController, StudentDocumentController } from './medical-document.controller';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { PositionService } from './position.service';
import { PositionController } from './position.controller';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { StudentAdmissionService } from './student-admission.service';
import { StaffOffboardingSubscriber } from './staff-offboarding.subscriber';
import { FeesModule } from '../fees/fees.module';
import { SchoolEnrollmentModule } from '../enrollment/enrollment.module';
import { PlacementLookupModule } from '../enrollment/placement-lookup.module';

@Module({
  // D1: the fee statement must read the ONE canonical fee calculation
  // (SchoolFinanceQueryService), not compute a balance of its own — that
  // divergence is exactly how it came to report waivers as money paid.
  imports: [FeesModule, SchoolEnrollmentModule, PlacementLookupModule],
  controllers: [
    StudentController,
    GuardianController,
    EmergencyContactController,
    MedicalRecordController,
    StudentDocumentController,
    StaffController,
    PositionController,
    StaffAttendanceController,
  ],
  providers: [
    StudentService,
    GuardianService,
    EmergencyContactService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
    StudentAdmissionService,
    StaffOffboardingSubscriber,
  ],
  exports: [
    StudentService,
    GuardianService,
    EmergencyContactService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
    StudentAdmissionService,
  ],
})
export class PeopleModule {}