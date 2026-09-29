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
        // The run executes as its creator. With no creator, or a creator whose
        // account is closed, it must not run at all — the permission lookup would
        // refuse anyway; this records why in words the school can act on.
        const creator = report.createdById
          ? await this.prisma.raw.user.findFirst({ where: { id: report.createdById }, select: { isActive: true } })
          : null;
        if (!creator?.isActive) {
          await this.prisma.raw.savedReportRun.update({
            where: { id: claimed.id },
            data: {
              status: 'failed',
              ranAt: new Date(),
              error: 'Not run: the person who scheduled this report no longer has an active account. Re-save it under an active user.',
            },
          });
          continue;
        }
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

  /**
   * Render, store, email; the run row records the outcome either way.
   *
   * Audit R04: a run is only `succeeded` when every recipient was actually
   * sent the report. `NotificationsService.send` reports a failed delivery as
   * `delivered: false` rather than throwing, and the run used to ignore it —
   * an SMTP outage produced a week of green "succeeded" runs that nobody
   * received. Now each recipient's outcome is recorded:
   *   succeeded       — file stored, every recipient sent (or none configured)
   *   partial         — file stored, some recipients failed
   *   delivery_failed — file stored, no recipient reached
   *   failed          — the report could not be produced (or its creator may no longer run it)
   * Failed recipients can be retried from the stored file without re-sending
   * to anyone who already received it.
   */
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
      const deliveries = await this.deliver(report, runId, report.emailTo ?? [], {
        filename: rendered.filename,
        contentType: rendered.contentType,
        buffer: rendered.buffer,
        rows: rendered.rows,
      });
      const status = deliveryStatus(deliveries);
      return this.prisma.raw.savedReportRun.update({
        where: { id: runId },
        data: {
          status,
          ranAt: new Date(),
          fileId: stored.id,
          deliveries: deliveries as any,
          error: status === 'succeeded' ? null : failureSummary(deliveries),
        },
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

  /** Send one run's file to `recipients`; one result per recipient, never thrown. */
  private async deliver(
    report: any,
    runId: string,
    recipients: string[],
    file: { filename: string; contentType: string; buffer: Buffer; rows?: number },
    previous: ReportDelivery[] = [],
  ): Promise<ReportDelivery[]> {
    const out: ReportDelivery[] = [];
    for (const to of recipients) {
      const before = previous.find((d) => d.recipient === to);
      const attempt = (before?.attempts ?? 0) + 1;
      try {
        const res = await this.notifications.send({
          organizationId: report.organizationId,
          channel: 'email',
          category: 'reports',
          recipient: { email: to },
          title: `${report.name} — ${new Date().toISOString().slice(0, 10)}`,
          body: `Your scheduled report "${report.name}" is attached${file.rows != null ? ` (${file.rows} rows)` : ''}.`,
          attachments: [{ filename: file.filename, content: file.buffer, contentType: file.contentType }],
          // One successful send per run and recipient: a retry never re-sends
          // to someone who already has it (the key is released on failure).
          dedupeKey: `saved-report:${runId}:${to}`,
        });
        if (res.delivered || res.duplicate) {
          out.push({ recipient: to, status: 'sent', attempts: attempt, at: new Date().toISOString() });
        } else {
          const why = await this.notificationError(res.id);
          out.push({ recipient: to, status: 'failed', attempts: attempt, at: new Date().toISOString(), error: why });
        }
      } catch (err) {
        out.push({ recipient: to, status: 'failed', attempts: attempt, at: new Date().toISOString(), error: String((err as Error)?.message ?? err).slice(0, 300) });
      }
    }
    return out;
  }

  private async notificationError(notificationId: string): Promise<string> {
    if (!notificationId) return 'Not sent';
    const row = await this.prisma.raw.notification.findFirst({ where: { id: notificationId }, select: { error: true, status: true } });
    return row?.error?.slice(0, 300) ?? (row?.status === 'failed' ? 'Not sent (recipient opted out or provider refused)' : 'Not sent');
  }

  /**
   * Re-send a run's stored file to the recipients it failed to reach. Those who
   * already received it are not sent it again. Runs as the caller, who needs the
   * same grants as running the report (checked by the controller and here).
   */
  async retryDeliveries(runId: string) {
    const run = await this.prisma.client.savedReportRun.findFirst({ where: { id: runId }, include: { report: true } });
    if (!run) throw new NotFoundException('Report run not found');
    if (!['partial', 'delivery_failed'].includes(run.status)) {
      throw new BadRequestException(`Only a run with failed deliveries can be retried (this one is ${run.status}).`);
    }
    if (!run.fileId) throw new BadRequestException('This run has no stored report to send.');
    await this.runner.assertMayRun(this.registry.get(run.report.reportKey));
    const previous = ((run as any).deliveries ?? []) as ReportDelivery[];
    const failed = previous.filter((d) => d.status === 'failed').map((d) => d.recipient);
    const file = await this.files.readStored(run.fileId);
    const retried = await this.deliver(run.report, run.id, failed, file, previous);
    const merged = previous.map((d) => retried.find((r) => r.recipient === d.recipient) ?? d);
    const status = deliveryStatus(merged);
    return this.prisma.client.savedReportRun.update({
      where: { id: run.id },
      data: { status, deliveries: merged as any, error: status === 'succeeded' ? null : failureSummary(merged) },
    });
  }
}

export interface ReportDelivery {
  recipient: string;
  status: 'sent' | 'failed';
  attempts: number;
  at: string;
  error?: string;
}

export function deliveryStatus(deliveries: ReportDelivery[]): 'succeeded' | 'partial' | 'delivery_failed' {
  const failed = deliveries.filter((d) => d.status === 'failed').length;
  if (failed === 0) return 'succeeded';
  return failed === deliveries.length ? 'delivery_failed' : 'partial';
}

function failureSummary(deliveries: ReportDelivery[]): string {
  const failed = deliveries.filter((d) => d.status === 'failed');
  return `Not delivered to ${failed.length} of ${deliveries.length}: ${failed.map((d) => `${d.recipient} (${d.error ?? 'failed'})`).join('; ')}`.slice(0, 500);
}
