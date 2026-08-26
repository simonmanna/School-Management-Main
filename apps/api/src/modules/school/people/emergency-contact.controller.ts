import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { EmergencyContactService } from './emergency-contact.service';
import { CreateEmergencyContactDto, UpdateEmergencyContactDto } from './dto.types';

@Controller('school/emergency-contacts')
export class EmergencyContactController {
  constructor(private readonly service: EmergencyContactService) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  listByStudent(@Param('studentProfileId') id: string) {
    return this.service.listByStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  create(@Body() dto: CreateEmergencyContactDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  update(@Param('id') id: string, @Body() dto: UpdateEmergencyContactDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
