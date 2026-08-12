import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { AcademicYearService, TermService } from './academic-year.service';
import type {
  CreateAcademicYearDto,
  CreateTermDto,
  SetCurrentYearDto,
  SetCurrentTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './dto.types';

@Controller('school/academic-years')
export class AcademicYearController {
  constructor(
    private readonly years: AcademicYearService,
    private readonly terms: TermService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.years.list(q);
  }

  @Get('current')
  @RequirePermissions(PERMISSIONS.school.read)
  async current() {
    const year = await this.years.list({ page: 1, pageSize: 1 } as any);
    const found = year.data.find((y: any) => y.isCurrent);
    return found ?? year.data[0] ?? null;
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.years.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateAcademicYearDto) {
    return this.years.create(dto);
  }

  @Post('set-current')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  setCurrent(@Body() dto: SetCurrentYearDto) {
    return this.years.setCurrent(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateAcademicYearDto) {
    return this.years.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.years.remove(id);
  }
}

@Controller('school/terms')
export class TermController {
  constructor(private readonly terms: TermService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.read)
  list(@Query() q: PaginationDto) {
    return this.terms.list(q);
  }

  @Get('current')
  @RequirePermissions(PERMISSIONS.school.read)
  current() {
    return this.terms.getCurrent();
  }

  @Get('by-year/:academicYearId')
  @RequirePermissions(PERMISSIONS.school.read)
  byYear(@Param('academicYearId') id: string) {
    return this.terms.byAcademicYear(id);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.read)
  findOne(@Param('id') id: string) {
    return this.terms.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  create(@Body() dto: CreateTermDto) {
    return this.terms.create(dto);
  }

  @Post('set-current')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  setCurrent(@Body() dto: SetCurrentTermDto) {
    return this.terms.setCurrent(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  update(@Param('id') id: string, @Body() dto: UpdateTermDto) {
    return this.terms.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.school.manageFoundation)
  remove(@Param('id') id: string) {
    return this.terms.remove(id);
  }
}