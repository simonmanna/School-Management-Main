import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { TermBoardService } from './term-board.service';

export class TermBoardActionDto {
  @IsString() @IsNotEmpty() termId!: string;
  /** Omit for every active class. */
  @IsOptional() @IsArray() @IsString({ each: true }) classIds?: string[];
}

/**
 * The Director of Studies' term board: one table of every class's progress and
 * the end-of-term steps run for all classes at once. Each action carries the
 * grant of the step it runs; the per-class service calls enforce the rest.
 */
@Controller('school/term-board')
export class TermBoardController {
  constructor(private readonly service: TermBoardService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  board(@Query('termId') termId: string) {
    if (!termId) throw new BadRequestException('termId is required');
    return this.service.board(termId);
  }

  @Post('class-lists')
  @RequirePermissions(PERMISSIONS.school.manageAssessments)
  lockClassLists(@Body() dto: TermBoardActionDto) {
    return this.service.lockClassLists(dto);
  }

  @Post('compute')
  @RequirePermissions(PERMISSIONS.school.computeResults)
  compute(@Body() dto: TermBoardActionDto) {
    return this.service.computeAll(dto);
  }

  @Post('publish')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  publish(@Body() dto: TermBoardActionDto) {
    return this.service.publishAll(dto);
  }

  @Post('build-cards')
  @RequirePermissions(PERMISSIONS.school.computeResults)
  buildCards(@Body() dto: TermBoardActionDto) {
    return this.service.buildCards(dto);
  }

  @Post('release-cards')
  @RequirePermissions(PERMISSIONS.school.publishResults)
  releaseCards(@Body() dto: TermBoardActionDto) {
    return this.service.releaseCards(dto);
  }
}
