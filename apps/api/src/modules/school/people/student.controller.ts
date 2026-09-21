import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StudentService } from './student.service';
import { CreateStudentDto, StudentListQueryDto, UpdateStudentDto } from './dto.types';
import { RegisterStudentDto, StudentAdmissionService } from './student-admission.service';

@Controller('school/students')
export class StudentController {
  constructor(
    private readonly students: StudentService,
    private readonly admission: StudentAdmissionService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: StudentListQueryDto) {
    return this.students.list(q);
  }

  @Get('by-class/:classId')
  @RequirePermissions(PERMISSIONS.school.read)
  byClass(@Param('classId') classId: string) {
    return this.students.listByClass(classId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.students.findOne(id);
  }

  @Get(':id/statement')
  @RequirePermissions(PERMISSIONS.school.read)
  statement(@Param('id') id: string) {
    return this.students.statement(id);
  }

  @Get(':id/activities')
  @RequirePermissions(PERMISSIONS.school.read)
  activities(@Param('id') id: string) {
    return this.students.activitiesForStudent(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }

  /**
   * Front-desk "register & place": create the learner, enrol them for the
   * term's year and seat them in a class (and stream) in one action.
   */
  @Post('register')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  register(@Body() dto: RegisterStudentDto) {
    return this.admission.register(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  /**
   * Bulk-import students from a CSV-shaped payload.
   * Body: { rows: Array<Record<string, string>> }
   *
   * Lookup is case-insensitive: the parser lowercases column headers so the
   * service receives `{admissionno, name, ...}`. We normalize here so
   * callers can send either case.
   */
  @Post('bulk-import')
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  bulkImport(@Body() body: { rows: Array<Record<string, string>> }) {
    const rows = (body.rows ?? []).map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
      return out;
    });
    return this.students.bulkImport(rows);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageStudents)
  remove(@Param('id') id: string) {
    return this.students.remove(id);
  }
}