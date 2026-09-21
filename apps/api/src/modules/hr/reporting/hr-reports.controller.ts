import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { RequiresModule } from '../../../kernel/module-loader/requires-module.decorator';
import { PermissionResolverService } from '../../../kernel/auth/permission-resolver.service';
import { ReportExportService } from '../../core/reporting/report-export.service';
import { ExportReportDto, RunReportDto } from '../../core/reporting/report-params.dto';
import { ReportRegistryService } from '../../core/reporting/report-registry.service';
import { ReportRunnerService } from '../../core/reporting/report-runner.service';

/**
 * The HR & payroll report centre.
 *
 * Permission is checked twice, deliberately, exactly as in the school centre:
 *
 *  1. The ROUTE grant, `hr:reports:read`. Not `hr:read` — that sits on most HR
 *     routes and nearly every HR user holds it, which would make this guard
 *     decorative.
 *  2. The PER-REPORT grant, enforced inside ReportRunnerService. A dispatch
 *     controller cannot say "the payroll register also needs hr:payroll" in a
 *     decorator, and that distinction is the whole point: reading the staff list
 *     and reading what everyone is paid are different disclosures.
 *
 * Handlers are written out rather than generated because
 * `route-permission-coverage.spec.ts` reads controller files as TEXT — a
 * factory-built controller carries no decorator lines for it to find.
 *
 * Run and export are POST so filters — which include `employeeId` — never land
 * in a query string, a URL bar or a proxy access log.
 */
@RequiresModule('hr')
@ApiTags('hr-reports')
@ApiBearerAuth()
@Controller('hr/reports/v2')
export class HrReportsController {
  constructor(
    private readonly registry: ReportRegistryService,
    private readonly runner: ReportRunnerService,
    private readonly exporter: ReportExportService,
    private readonly permissions: PermissionResolverService,
  ) {}

  /** Only the HR reports this caller may actually run. */
  @Get('catalog')
  @RequirePermissions(PERMISSIONS.hr.readReports)
  async catalog() {
    const granted = await this.permissions.grantedForCaller();
    return this.registry.catalog(granted, 'hr');
  }

  /** Filters, columns and shape for one report — drives the runner page. */
  @Get(':key/meta')
  @RequirePermissions(PERMISSIONS.hr.readReports)
  async meta(@Param('key') key: string) {
    const def = this.registry.get(key);
    await this.runner.assertMayRun(def);
    return this.registry.describe(def);
  }

  @Post(':key/run')
  @RequirePermissions(PERMISSIONS.hr.readReports)
  run(@Param('key') key: string, @Body() dto: RunReportDto) {
    return this.runner.run(key, dto);
  }

  @Post(':key/export')
  @RequirePermissions(PERMISSIONS.hr.readReports, PERMISSIONS.hr.exportReports)
  export(
    @Param('key') key: string,
    @Body() dto: ExportReportDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.exporter.export(key, dto, res);
  }
}
