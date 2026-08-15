import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { ExamRegistrationService, ExamVenueService } from './exam-ops.service';
import {
  AllocateSeatsDto,
  CreateExamVenueDto,
  RegisterCandidatesDto,
  RegisterClassDto,
  UpdateExamRegistrationDto,
  UpdateExamVenueDto,
} from './exam-ops.dto';

@Controller('school/exam-venues')
export class ExamVenueController {
  constructor(private readonly service: ExamVenueService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.service.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageExams)
  create(@Body() dto: CreateExamVenueDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  update(@Param('id') id: string, @Body() dto: UpdateExamVenueDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageExams)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Controller('school/exam-registrations')
export class ExamRegistrationController {
  constructor(private readonly service: ExamRegistrationService) {}

  @Get('by-exam/:examId')
  @RequirePermissions(PERMISSIONS.school.read)
  byExam(@Param('examId') examId: string) {
    return this.service.byExam(examId);
  }

  @Post('register-class')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  registerClass(@Body() dto: RegisterClassDto) {
    return this.service.registerClass(dto.examId, dto.classId);
  }

  @Post('register')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  register(@Body() dto: RegisterCandidatesDto) {
    return this.service.register(dto);
  }

  @Post('allocate-seats')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  allocateSeats(@Body() dto: AllocateSeatsDto) {
    return this.service.allocateSeats(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateExamRegistrationDto) {
    return this.service.updateStatus(id, dto);
  }
}
