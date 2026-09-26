import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { GuardianService } from './guardian.service';
import { CreateGuardianDto, UpdateGuardianDto } from './dto.types';

@Controller('school/guardians')
export class GuardianController {
  constructor(
    private readonly guardians: GuardianService,
    private readonly dataScope: DataScopeService,
  ) {}

  @Get('by-student/:studentProfileId')
  @RequirePermissions(PERMISSIONS.school.read)
  async listByStudent(@Param('studentProfileId') id: string) {
    // Re-audit #3 P1-15: guardian names and phone numbers of any pupil were
    // readable by a class-scoped teacher; they now follow the pupil's scope.
    await this.dataScope.assertMayReadStudent(id);
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