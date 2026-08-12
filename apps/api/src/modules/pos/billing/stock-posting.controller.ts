import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { StockPostingService } from './stock-posting.service';

class ResolveExceptionDto {
  @IsIn(['resolved', 'discarded']) status!: 'resolved' | 'discarded';
  @IsString() note!: string;
}
class AssignExceptionDto {
  @IsString() assignedToId!: string;
}

/**
 * Phase 1 (accounting hardening) — Posting Monitor.
 *
 * Surfaces the durable inventory-posting queue (`StockPostingJob`) and the
 * exception work-queue (`InventoryException`) so stock drift is visible and
 * actionable instead of a silent audit marker.
 */
@ApiTags('pos/posting-monitor')
@ApiBearerAuth()
@Controller('pos/posting-monitor')
export class StockPostingController {
  constructor(private readonly svc: StockPostingService) {}

  @Get('counts')
  @RequirePermissions('pos:reports')
  counts() {
    return this.svc.counts();
  }

  @Get('jobs')
  @RequirePermissions('pos:reports')
  jobs(@Query('status') status?: string) {
    return this.svc.listJobs(status ?? 'all');
  }

  @Post('jobs/:id/retry')
  @RequirePermissions('pos:override')
  retryJob(@Param('id') id: string) {
    return this.svc.retryJob(id);
  }

  @Get('exceptions')
  @RequirePermissions('pos:reports')
  exceptions(@Query('status') status?: string) {
    return this.svc.listExceptions(status ?? 'open');
  }

  @Post('exceptions/:id/assign')
  @RequirePermissions('pos:override')
  assign(@Param('id') id: string, @Body() dto: AssignExceptionDto) {
    return this.svc.assignException(id, dto.assignedToId);
  }

  @Post('exceptions/:id/resolve')
  @RequirePermissions('pos:override')
  resolve(@Param('id') id: string, @Body() dto: ResolveExceptionDto) {
    return this.svc.resolveException(id, dto.status, dto.note);
  }
}
