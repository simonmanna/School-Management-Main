import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { BillingRunService } from './billing-run.service';

@Controller('school/billing-runs')
export class BillingRunController {
  constructor(private readonly runs: BillingRunService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.school.readFees)
  list() {
    return this.runs.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.school.readFees)
  get(@Param('id') id: string) {
    return this.runs.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.school.manageFees)
  start(@Body() dto: { termId: string; classId?: string }) {
    return this.runs.start(dto.termId, dto.classId);
  }

  @Post(':id/process')
  @RequirePermissions(PERMISSIONS.school.manageFees)
  process(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.runs.process(id, limit ? Number(limit) : undefined);
  }
}
