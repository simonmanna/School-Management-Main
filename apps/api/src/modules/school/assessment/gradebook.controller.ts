import { Body, Controller, Delete, Get, GoneException, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { GradebookService } from './gradebook.service';
import { GradebookCellDto, GradebookColumnDto, LockColumnDto, UpdateGradebookColumnDto } from './gradebook.dto';

/**
 * The gradebook — one class × term × subject spreadsheet over the spine.
 *
 *   GET    /school/gradebook/sheet     → students × assessment columns + live totals
 *   POST   /school/gradebook/cell      → save one mark (manual columns only)
 *   POST   /school/gradebook/column    → add a column (a "CAT 2", a "Homework 3")
 *   PATCH  /school/gradebook/column/:id
 *   DELETE /school/gradebook/column/:id
 *   POST   /school/gradebook/column/:id/lock
 */
@Controller('school/gradebook')
export class GradebookController {
  constructor(private readonly service: GradebookService) {}

  @Get('sheet')
  @RequirePermissions(PERMISSIONS.school.read)
  sheet(
    @Query('classId') classId: string,
    @Query('termId') termId: string,
    @Query('subjectId') subjectId?: string,
    @Query('streamId') streamId?: string,
  ) {
    return this.service.sheet({ classId, termId, subjectId: subjectId || undefined, streamId: streamId || undefined });
  }

  @Get('subjects')
  @RequirePermissions(PERMISSIONS.school.read)
  subjects(@Query('classId') classId: string) {
    return this.service.subjectsForClass(classId);
  }

  @Post('cell')
  @RequirePermissions(PERMISSIONS.school.enterGrades)
  cell(@Body() dto: GradebookCellDto) {
    throw new GoneException('The legacy gradebook is read-only. Save drafts through the Assessment Board markbook.');
  }

  @Post('column')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  createColumn(@Body() dto: GradebookColumnDto) {
    throw new GoneException('Create assessments through /school/assessment-board with a course and frozen roster.');
  }

  @Patch('column/:id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  updateColumn(@Param('id') id: string, @Body() dto: UpdateGradebookColumnDto) {
    throw new GoneException('The legacy gradebook is read-only. Use the Assessment Board.');
  }

  @Delete('column/:id')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  deleteColumn(@Param('id') id: string, @Query('force') force?: string) {
    throw new GoneException('Academic evidence is retained. Archive assessments through their canonical lifecycle.');
  }

  @Post('column/:id/lock')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  lock(@Param('id') id: string, @Body() dto: LockColumnDto) {
    return this.service.setLock(id, dto.locked);
  }
}
