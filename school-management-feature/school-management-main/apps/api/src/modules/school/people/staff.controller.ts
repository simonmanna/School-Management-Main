import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StaffService } from './staff.service';
import type { CreateStaffDto, UpdateStaffDto } from './dto.types';

@Controller('school/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.staff.list(q);
  }

  @Get('by-campus/:campusId')
  @RequirePermissions(PERMISSIONS.school.read)
  byCampus(@Param('campusId') id: string) {
    return this.staff.listByCampus(id);
  }

  @Get('by-department/:departmentId')
  @RequirePermissions(PERMISSIONS.school.read)
  byDepartment(@Param('departmentId') id: string) {
    return this.staff.listByDepartment(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageStaff)
  remove(@Param('id') id: string) {
    return this.staff.remove(id);
  }
}