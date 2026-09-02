import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { PermissionResolverService } from '../../../kernel/auth/permission-resolver.service';
import { ReportExportService } from '../../core/reporting/report-export.service';
import { ExportReportDto, RunReportDto } from '../../core/reporting/report-params.dto';
import { ReportRegistryService } from '../../core/reporting/report-registry.service';
import { ReportRunnerService } from '../../core/reporting/report-runner.service';

/**
 * The school report centre.
 *
 * Two layers of permission, deliberately:
 *
 *  1. The ROUTE grant below. `school:reports:read` rather than `school:read` —
 *     the latter sits on ~300 routes and effectively everyone holds it, which
 *     would make this guard decorative.
 *  2. The PER-REPORT grant, checked inside ReportRunnerService. A generic
 *     dispatch controller cannot express "fees reports need the finance grant"
 *     in a decorator, so the runner enforces `definition.permission` +
 *     `alsoRequires` on every run and every export.
 *
 * Handlers are written out rather than generated. `route-permission-coverage.spec.ts`
 * and `permission-catalog-drift.spec.ts` read controller files as TEXT — a
 * factory-built controller would carry no `@Get`/`@RequirePermissions` lines for
 * them to find, and the guard-rails would go quietly blind.
 *
 * Run and export are POST so that filters — which include `studentProfileId` —
 * never land in a query string, a URL bar, or a proxy access log.
 */
@ApiTags('school-reports')
@ApiBearerAuth()
@Controller('school/reports/v2')
export class SchoolReportsController {
  constructor(
    private readonly registry: ReportRegistryService,
    private readonly runner: ReportRunnerService,
    private readonly exporter: ReportExportService,
    private readonly permissions: PermissionResolverService,
  ) {}

  /** Only the reports this caller may actually run. */
  @Get('catalog')
  @RequirePermissions(PERMISSIONS.school.readReports)
  async catalog() {
    const granted = await this.permissions.grantedForCaller();
    return this.registry.catalog(granted, 'school');
  }

  /** Filters, columns and shape for one report — drives the runner page. */
  @Get(':key/meta')
  @RequirePermissions(PERMISSIONS.school.readReports)
  async meta(@Param('key') key: string) {
    const def = this.registry.get(key);
    await this.runner.assertMayRun(def);
    return this.registry.describe(def);
  }

  @Post(':key/run')
  @RequirePermissions(PERMISSIONS.school.readReports)
  run(@Param('key') key: string, @Body() dto: RunReportDto) {
    return this.runner.run(key, dto);
  }

  @Post(':key/export')
  @RequirePermissions(PERMISSIONS.school.readReports, PERMISSIONS.school.exportReports)
  export(
    @Param('key') key: string,
    @Body() dto: ExportReportDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.exporter.export(key, dto, res);
  }
}
