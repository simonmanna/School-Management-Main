import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MedicalRecordService } from './medical-record.service';
import { StudentDocumentService } from './student-document.service';
import { CreateStudentDocumentDto, UpsertMedicalRecordDto } from './dto.types';

@Controller('school/students/:studentProfileId/medical-record')
export class MedicalRecordController {
  constructor(private readonly service: MedicalRecordService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  get(@Param('studentProfileId') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  upsert(@Param('studentProfileId') id: string, @Body() body: Omit<UpsertMedicalRecordDto, 'studentProfileId'>) {
    return this.service.upsert({ ...body, studentProfileId: id });
  }
}

@Controller('school/students/:studentProfileId/documents')
export class StudentDocumentController {
  constructor(private readonly service: StudentDocumentService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Param('studentProfileId') id: string) {
    return this.service.listByStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  add(@Param('studentProfileId') id: string, @Body() body: Omit<CreateStudentDocumentDto, 'studentProfileId'>) {
    return this.service.create({ ...body, studentProfileId: id });
  }

  @Patch(':id/verify')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  verify(@Param('id') id: string, @Body('verified') verified: boolean) {
    return this.service.verify(id, verified);
  }
}