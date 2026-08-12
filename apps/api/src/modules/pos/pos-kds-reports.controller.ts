/**
 * POS KDS — kitchen performance + live-ops reporting. Manager-gated (pos:reports).
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { PosKdsReportsService } from './pos-kds-reports.service';

@ApiTags('pos/kds/reports')
@ApiBearerAuth()
@Controller('pos/kds/reports')
export class PosKdsReportsController {
  constructor(private readonly svc: PosKdsReportsService) {}

  @Get('summary')
  @RequirePermissions('pos:reports')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.summary(from, to);
  }

  @Get('live')
  @RequirePermissions('pos:reports')
  live() {
    return this.svc.live();
  }
}
