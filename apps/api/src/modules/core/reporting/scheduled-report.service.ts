import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronTime } from 'cron';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { FilesService } from '../../../kernel/files/files.service';
import { NotificationsService } from '../../../kernel/notifications/notifications.service';
import { safeTimeZone } from '../../../kernel/common/school-time';
import { ReportExportService } from './report-export.service';
import { ReportRunnerService } from './report-runner.service';
import { ReportRegistryService } from './report-registry.service';

export interface SavedReportInput {
  name: string;
  reportKey: string;
  parameters?: Record<string, unknown>;
  /** Five-field cron in the school's time zone, e.g. "0 7 * * 1" (Mondays 07:00). */
  schedule?: string | null;
  format?: 'csv' | 'xlsx' | 'pdf';
  emailTo?: string[];
}

const MIN_INTERVAL_MS = 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Wave 16 — saved and scheduled reports.
 *
 * `SavedReport.schedule` / `emailTo` and `SavedReportRun` existed in the schema
 * and nothing read them. This runs them: every ten minutes, each due schedule
 * produces one run — claimed by a unique (report, scheduledFor) row so two API
 * instances cannot both send it — renders through the same export path as a
 * manual download, stores the file, and emails it.
 *
 * A scheduled run executes AS ITS CREATOR, with that person's permissions as
 * they are at run time. Someone who has lost access to fee reports stops
 * receiving them the next morning; the schedule does not keep a copy of
 * yesterday's grants.
 */
@Injectable()
export class ScheduledReportService {
  private readonly log = new Logger('ScheduledReports');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly exporter: ReportExportService,
    private readonly runner: ReportRunnerService,
    private readonly registry: ReportRegistryService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ── CRUD (called by a vertical's decorated controller) ── */

  list(namespacePrefix?: string) {
    return this.prisma.client.savedReport.findMany({
      where: namespacePrefix ? { reportKey: { startsWith: namespacePrefix } } : {},
      orderBy: { createdAt: 'desc' },
      include: { runs: { orderBy: { scheduledFor: 'desc' }, take: 5 } },
    });
  }

  async create(input: SavedReportInput) {
    await this.validate(input);
    return this.prisma.client.savedReport.create({
      data: {
        organizationId: this.tenant.organizationId,
        name: input.name.trim(),
        reportKey: input.reportKey,
        parameters: (input.parameters ?? {}) as any,
        schedule: input.schedule?.trim() || null,
        format: input.format ?? 'pdf',
        emailTo: (input.emailTo ?? []).map((e) => e.trim().toLowerCase()),
        createdById: this.tenant.userId ?? null,
      },
    });
  }

  async update(id: string, input: Partial<SavedReportInput>) {
    const row = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Saved report not found');
    const merged = {
      name: input.name ?? row.name,
      reportKey: row.reportKey,
      parameters: (input.parameters ?? row.parameters) as Record<string, unknown>,
      schedule: input.schedule !== undefined ? input.schedule : row.schedule,
      format: (input.format ?? row.format) as SavedReportInput['format'],
      emailTo: input.emailTo ?? row.emailTo,
    };
    await this.validate(merged);
    return this.prisma.client.savedReport.update({
      where: { id },
      data: {
        name: merged.name.trim(),
        parameters: merged.parameters as any,
        schedule: merged.schedule?.trim() || null,
        format: merged.format,
        emailTo: merged.emailTo.map((e) => e.trim().toLowerCase()),
      },
    });
  }

  async remove(id: string) {
    const row = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Saved report not found');
    await this.prisma.client.savedReport.delete({ where: { id } });
    return { deleted: true };
  }

  /** Run one saved report now, as the caller. */
  async runNow(id: string) {
    const row = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Saved report not found');
    const run = await this.prisma.client.savedReportRun.create({
      data: { organizationId: row.organizationId, reportId: row.id, scheduledFor: new Date(), status: 'running' },
    });
    return this.execute(row, run.id);
  }

  private async validate(input: SavedReportInput) {
    if (!input.name?.trim()) throw new BadRequestException('Name the saved report.');
    const def = this.registry.get(input.reportKey); // throws for an unknown key
    // Saving a schedule for a report you cannot run would only fail later, silently.
    await this.runner.assertMayRun(def);
    if (!['csv', 'xlsx', 'pdf'].includes(input.format ?? 'pdf')) throw new BadRequestException('Format must be csv, xlsx or pdf.');
    for (const e of input.emailTo ?? []) if (!EMAIL.test(e.trim())) throw new BadRequestException(`"${e}" is not an email address.`);
    if (input.schedule?.trim()) {
      const tz = await this.orgTimeZone(this.tenant.organizationId);
      let cron: CronTime;
      try {
        cron = new CronTime(input.schedule.trim(), tz);
      } catch {
        throw new BadRequestException('The schedule is not a valid cron expression (e.g. "0 7 * * 1" for Mondays at 07:00).');
      }
      const a = cron.getNextDateFrom(new Date(), tz).toJSDate();
      const b = cron.getNextDateFrom(a, tz).toJSDate();
      if (b.getTime() - a.getTime() < MIN_INTERVAL_MS) throw new BadRequestException('A report can be scheduled at most once an hour.');
      if (!(input.emailTo ?? []).length) throw new BadRequestException('A scheduled report needs at least one email address to go to.');
    }
  }

  private async orgTimeZone(organizationId: string): Promise<string> {
    const org = await this.prisma.raw.organization.findFirst({ where: { id: organizationId }, select: { timezone: true } });
    return safeTimeZone(org?.timezone);
  }

  /* ── the scheduler ── */

  @Cron(process.env.SCHEDULED_REPORTS_CRON ?? '*/10 * * * *', { name: 'scheduled-reports' })
  async tick(now = new Date()) {
    const due = await this.prisma.raw.savedReport.findMany({
      where: { schedule: { not: null } },
      include: { runs: { orderBy: { scheduledFor: 'desc' }, take: 1, select: { scheduledFor: true } } },
    });
    let ran = 0;
    for (const report of due) {
      try {
        const tz = await this.orgTimeZone(report.organizationId);
        const cron = new CronTime(report.schedule!, tz);
        const since = report.runs[0]?.scheduledFor ?? report.createdAt;
        const slot = cron.getNextDateFrom(since, tz).toJSDate();
        if (slot > now) continue;
        // One run per slot, across every instance: the unique index decides.
        const claimed = await this.prisma.raw.savedReportRun
          .create({ data: { organizationId: report.organizationId, reportId: report.id, scheduledFor: slot, status: 'running' } })
          .catch((err: any) => (err?.code === 'P2002' ? null : Promise.reject(err)));
        if (!claimed) continue;
        await this.tenant.run(
          { organizationId: report.organizationId, userId: report.createdById ?? undefined },
          () => this.execute(report, claimed.id),
        );
        ran++;
      } catch (err) {
        this.log.error(`scheduled report ${report.id} failed to start: ${(err as Error).message}`);
      }
    }
    return { ran };
  }

  /** Render, store, email; the run row records the outcome either way. */
  private async execute(report: any, runId: string) {
    try {
      const rendered = await this.exporter.render(report.reportKey, {
        page: 1,
        pageSize: 100,
        filters: report.parameters ?? {},
        format: report.format,
      } as any);
      const stored = await this.files.upload({
        filename: rendered.filename,
        contentType: rendered.contentType,
        buffer: rendered.buffer,
        ownerType: 'SavedReportRun',
        ownerId: runId,
      });
      for (const to of report.emailTo ?? []) {
        await this.notifications
          .send({
            organizationId: report.organizationId,
            channel: 'email',
            category: 'reports',
            recipient: { email: to },
            title: `${report.name} — ${new Date().toISOString().slice(0, 10)}`,
            body: `Your scheduled report "${report.name}" is attached (${rendered.rows} rows).`,
            attachments: [{ filename: rendered.filename, content: rendered.buffer, contentType: rendered.contentType }],
            dedupeKey: `saved-report:${runId}:${to}`,
          })
          .catch((err) => this.log.warn(`report ${report.id} email to ${to} failed: ${String(err)}`));
      }
      return this.prisma.raw.savedReportRun.update({
        where: { id: runId },
        data: { status: 'succeeded', ranAt: new Date(), fileId: stored.id, error: null },
      });
    } catch (err) {
      const message = (err as Error).message?.slice(0, 500) ?? String(err);
      this.log.warn(`saved report ${report.id} run ${runId} failed: ${message}`);
      return this.prisma.raw.savedReportRun.update({
        where: { id: runId },
        data: { status: 'failed', ranAt: new Date(), error: message },
      });
    }
  }
}
