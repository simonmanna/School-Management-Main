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

@Module({
  controllers: [
    StudentController,
    GuardianController,
    MedicalRecordController,
    StudentDocumentController,
    StaffController,
    PositionController,
    StaffAttendanceController,
  ],
  providers: [
    StudentService,
    GuardianService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
  ],
  exports: [
    StudentService,
    GuardianService,
    MedicalRecordService,
    StudentDocumentService,
    StaffService,
    PositionService,
    StaffAttendanceService,
  ],
})
export class PeopleModule {}