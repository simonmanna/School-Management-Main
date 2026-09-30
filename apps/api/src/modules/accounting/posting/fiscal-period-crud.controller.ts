import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { FiscalPeriodLifecycleService } from './fiscal-period-lifecycle.service';

export class CreateFiscalPeriodDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  /** First calendar day of the period (YYYY-MM-DD). */
  @IsDateString() startDate!: string;
  /** Last calendar day of the period (YYYY-MM-DD), inclusive. */
  @IsDateString() endDate!: string;
}

export class UpdateFiscalPeriodDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}

export class ReopenFiscalPeriodDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

/**
 * The one fiscal-period API (wave 18). Status never travels in a create/update
 * body; it changes only through close / lock (PeriodCloseController) and
 * reopen / unlock here, each with its own permission.
 */
@Controller('fiscal-periods')
export class FiscalPeriodCrudController {
  constructor(private readonly periods: FiscalPeriodLifecycleService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.fiscalPeriod.read)
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(Math.max(1, Number(pageSize) || 50), 200);
    return this.periods.list(p, ps);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.read)
  findOne(@Param('id') id: string) {
    return this.periods.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.fiscalPeriod.create)
  create(@Body() dto: CreateFiscalPeriodDto) {
    return this.periods.create(dto);
  }

  /** Rename or re-date an OPEN period. */
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.update)
  update(@Param('id') id: string, @Body() dto: UpdateFiscalPeriodDto) {
    return this.periods.update(id, dto);
  }

  /** Delete an open period that has never been closed. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.fiscalPeriod.delete)
  async remove(@Param('id') id: string) {
    await this.periods.remove(id);
  }

  /** closed → open. Reverses the closing entry; audited with the reason. */
  @Post(':id/reopen')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.reopen)
  reopen(@Param('id') id: string, @Body() dto: ReopenFiscalPeriodDto) {
    return this.periods.reopen(id, dto.reason, 'reopen');
  }

  /** locked → open. Break-glass: Administrator only. */
  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.fiscalPeriod.unlock)
  unlock(@Param('id') id: string, @Body() dto: ReopenFiscalPeriodDto) {
    return this.periods.reopen(id, dto.reason, 'unlock');
  }
}
