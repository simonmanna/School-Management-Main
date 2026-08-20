import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/**
 * HrAlertsSubscriber — scheduled HR alert sweeps. Fires in-app notifications for:
 *   • Contracts expiring within 60 days
 *   • Teaching/other certifications expiring within 30 days
 *   • Employees whose probation ends within 14 days
 *
 * Runs on demand via `runAlerts()` (exposed as POST /hr/alerts/run from the
 * controller). It is idempotent per (kind, employee, day) via the dedupe key in
 * NotificationsService. Queries are scoped per org directly (not via the tenant
 * context) so a single sweep can cover every organization.
 */
@Injectable()
export class HrAlertsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('HrAlerts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantContextService,
  ) {}

  onModuleInit() {
    // No event-bus hook needed; the sweep is manual/scheduled. Lives here so all
    // HR alert logic is co-located with the module.
  }

  async runAlerts(orgId?: string) {
    const ids = orgId ? [orgId] : await this.allOrgIds();
    let fired = 0;
    for (const id of ids) fired += await this.sweepOrg(id);
    return { fired };
  }

  private async allOrgIds(): Promise<string[]> {
    const rows = await this.prisma.client.organization.findMany({ select: { id: true } });
    return rows.map((r: any) => r.id);
  }

  private async sweepOrg(orgId: string): Promise<number> {
    let count = 0;

    // 1. Contracts expiring (≤60d).
    const horizon = new Date(Date.now() + 60 * 86400000);
    const contracts = await this.prisma.client.hrContract.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { in: ['active', 'expiring'] },
        endDate: { gte: new Date(), lte: horizon },
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
    });
    for (const c of contracts) {
      count += await this.notify(orgId, 'hr_contract_expiry', c.employeeId, {
        subject: 'Contract expiring',
        body: `${c.employee.firstName} ${c.employee.lastName ?? ''} (${c.employee.employeeCode}) — contract ${c.contractNumber} expires ${c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : 'soon'}.`,
        meta: { contractId: c.id, employeeId: c.employeeId },
      });
    }

    // 2. Certifications expiring (≤30d).
    const certHorizon = new Date(Date.now() + 30 * 86400000);
    const certs = await this.prisma.client.hrCertification.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'active',
        expiryDate: { gte: new Date(), lte: certHorizon },
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } },
    });
    for (const c of certs) {
      count += await this.notify(orgId, 'hr_cert_expiry', c.employeeId, {
        subject: 'Certification expiring',
        body: `${c.employee.firstName} ${c.employee.lastName ?? ''} (${c.employee.employeeCode}) — certification "${c.name}" expires ${c.expiryDate ? new Date(c.expiryDate).toISOString().slice(0, 10) : 'soon'}.`,
        meta: { certificationId: c.id, employeeId: c.employeeId },
      });
    }

    // 3. Probation ending (≤14d).
    const probHorizon = new Date(Date.now() + 14 * 86400000);
    const probationers = await this.prisma.client.hrEmployee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        probationEndDate: { gte: new Date(), lte: probHorizon },
      },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    for (const e of probationers) {
      count += await this.notify(orgId, 'hr_probation_end', e.id, {
        subject: 'Probation ending',
        body: `${e.firstName} ${e.lastName ?? ''} (${e.employeeCode}) — probation ends soon.`,
        meta: { employeeId: e.id },
      });
    }

    return count;
  }

  private async notify(orgId: string, kind: string, employeeId: string | null, payload: { subject: string; body: string; meta: Record<string, unknown> }) {
    const dedupeKey = `${kind}:${employeeId ?? 'org'}:${new Date().toISOString().slice(0, 10)}`;
    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'hr',
      title: payload.subject,
      body: payload.body,
      payload: { ...payload.meta, kind, dedupeKey },
    } as any).catch((err: Error) => this.logger.error(`notify failed: ${err.message}`));
    return 1;
  }
}
