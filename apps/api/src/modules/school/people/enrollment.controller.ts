import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EnrollmentService, EnrollStudentDto, EndEnrollmentDto, RegisterStudentDto } from './enrollment.service';

@Controller('school/enrollments')
export class EnrollmentController {
  constructor(
    private readonly service: EnrollmentService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(this.tenant.organizationId, {
      studentProfileId: (q as any).studentProfileId,
      termId: (q as any).termId,
      status: (q as any).status,
    });
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.school.read)
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Post('register')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  register(@Body() dto: RegisterStudentDto) {
    return this.service.register(dto);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  enroll(@Body() dto: EnrollStudentDto) {
    return this.service.enroll(dto);
  }

  @Post(':id/transfer-out')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  transferOut(@Param('id') id: string, @Body() dto: EndEnrollmentDto) {
    return this.service.transferOut(id, dto);
  }

  @Post(':id/withdraw')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  withdraw(@Param('id') id: string, @Body() dto: EndEnrollmentDto) {
    return this.service.withdraw(id, dto);
  }

  @Post(':id/re-enroll')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  reEnroll(@Param('id') id: string, @Body() dto: EndEnrollmentDto) {
    return this.service.reEnroll(id, dto);
  }
}
