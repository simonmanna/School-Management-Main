import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { GuardianService } from './guardian.service';
import type { CreateGuardianDto, UpdateGuardianDto } from './dto.types';

@Controller('school/guardians')
export class GuardianController {
  constructor(private readonly guardians: GuardianService) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  listByStudent(@Param('studentProfileId') id: string) {
    return this.guardians.listByStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  create(@Body() dto: CreateGuardianDto) {
    return this.guardians.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  update(@Param('id') id: string, @Body() dto: UpdateGuardianDto) {
    return this.guardians.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  remove(@Param('id') id: string) {
    return this.guardians.remove(id);
  }
}