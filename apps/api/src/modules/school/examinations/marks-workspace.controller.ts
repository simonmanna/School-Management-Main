import { ScopedToClass } from '../../../kernel/auth/guards/scoped-to-class.decorator';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { MarksWorkspaceService } from './marks-workspace.service';
import { ApplyClassesDto, LockMarksDto, RemoveClassDto, SaveMarkDto } from './marks-workspace.dto';

/**
 * The exam workspace API — four steps, four screens, one endpoint each.
 *
 *   1. `GET  /school/marks/exams`      → what exams exist, how far along they are
 *   2. `GET  /school/marks/coverage`   → which classes sit this exam (+ `apply-classes`)
 *   3. `GET  /school/marks/sheet`      → one paper's marksheet (+ `entry` to autosave)
 *   4. `GET  /school/marks/grid`       → the results sheet (+ `lock`)
 *
 * These wrap the existing exam/grade services rather than replacing them, so
 * marks entered here are the same rows the report cards and assessment spine
 * already read.
 */
@Controller('school/marks')
export class MarksWorkspaceController {
  constructor(private readonly service: MarksWorkspaceService) {}

  @Get('exams')
  @RequirePermissions(PERMISSIONS.school.read)
  exams(@Query('termId') termId?: string, @Query('academicYearId') academicYearId?: string) {
    return this.service.exams({ termId, academicYearId });
  }

  @Get('coverage')
  @RequirePermissions(PERMISSIONS.school.read)
  coverage(@Query('examId') examId: string) {
    return this.service.coverage(examId);
  }

  @Get('subjects')
  @ScopedToClass('classId')
  @RequirePermissions(PERMISSIONS.school.read)
  subjects(@Query('classId') classId: string) {
    return this.service.subjectsForClass(classId);
  }

  @Post('apply-classes')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  applyClasses(@Body() dto: ApplyClassesDto) {
    return this.service.applyClasses(dto);
  }

  @Post('remove-class')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  removeClass(@Body() dto: RemoveClassDto) {
    return this.service.removeClass(dto);
  }

  @Get('sheet')
  @ScopedToClass('classId')
  @RequirePermissions(PERMISSIONS.school.read)
  sheet(
    @Query('examId') examId: string,
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.service.sheet({ examId, classId, subjectId, sectionId: sectionId || undefined });
  }

  @Post('entry')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  saveMark(@Body() dto: SaveMarkDto) {
    return this.service.saveMark(dto);
  }

  @Get('grid')
  @ScopedToClass('classId')
  @RequirePermissions(PERMISSIONS.school.read)
  grid(
    @Query('examId') examId: string,
    @Query('classId') classId: string,
    @Query('sectionId') sectionId?: string,
  ) {
    return this.service.grid({ examId, classId, sectionId: sectionId || undefined });
  }

  @Post('lock')
  @RequirePermissions(PERMISSIONS.school.manageExams)
  lock(@Body() dto: LockMarksDto) {
    return this.service.setLock(dto);
  }
}
