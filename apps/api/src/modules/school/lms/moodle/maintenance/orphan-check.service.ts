import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../../../kernel/tenancy/tenant-context.service';
import { ActivityRegistry } from '../activity/activity-registry.service';

export interface OrphanRow {
  courseModuleId: string;
  courseOfferingId: string;
  activityType: string;
  instanceId: string;
  reason: 'missing_instance' | 'unregistered_type';
}

/**
 * The condition ADR-014 attached to its own decision.
 *
 * `CourseModule.instanceId` is an untyped polymorphic FK — `activityType` decides
 * which table it points into, so the database cannot enforce it. ADR-014 accepted
 * that (Moodle does the same) explicitly ON CONDITION that a reconciler watches
 * for dangling rows. This is that reconciler; without it the trade-off was never
 * actually paid for.
 *
 * A dangling module is not cosmetic: the course page renders a row that 404s when
 * opened, the gradebook may carry an Assessment nothing can be marked against, and
 * completion percentages count a module no student can ever finish.
 *
 * Reporting and repair are deliberately separate. An orphan usually means a bug in
 * a delete path, and auto-deleting the evidence would hide it — so the nightly job
 * only reports, and repair is an explicit, audited call.
 */
@Injectable()
export class LmsOrphanCheckService {
  private readonly logger = new Logger('LmsOrphanCheck');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: ActivityRegistry,
  ) {}

  /**
   * Find modules whose instance row has gone. Runs per-organization so the
   * Prisma tenancy extension scopes correctly.
   */
  async scan(organizationId: string): Promise<OrphanRow[]> {
    const modules = await this.prisma.raw.courseModule.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, courseOfferingId: true, activityType: true, instanceId: true },
    });
    if (modules.length === 0) return [];

    // Group by type so each plugin table is hit once with an `in` list rather
    // than once per module — a 14-week course with 200 activities should not
    // become 200 round trips every night.
    const byType = new Map<string, typeof modules>();
    for (const m of modules) {
      const list = byType.get(m.activityType) ?? [];
      list.push(m);
      byType.set(m.activityType, list);
    }

    const orphans: OrphanRow[] = [];
    for (const [type, rows] of byType) {
      if (!this.registry.has(type)) {
        // The module names a plugin that no longer exists — a removed or renamed
        // activity type. Nothing can render it, so it is reported the same way.
        orphans.push(
          ...rows.map((r) => ({
            courseModuleId: r.id,
            courseOfferingId: r.courseOfferingId,
            activityType: type,
            instanceId: r.instanceId,
            reason: 'unregistered_type' as const,
          })),
        );
        continue;
      }
      const plugin = this.registry.get(type);
      if (!plugin.liveInstanceIds) continue; // plugin opted out of the check
      const ids = rows.map((r) => r.instanceId).filter(Boolean);
      const alive = await plugin.liveInstanceIds(ids);
      for (const r of rows) {
        if (!r.instanceId || !alive.has(r.instanceId)) {
          orphans.push({
            courseModuleId: r.id,
            courseOfferingId: r.courseOfferingId,
            activityType: type,
            instanceId: r.instanceId,
            reason: 'missing_instance',
          });
        }
      }
    }
    return orphans;
  }

  /**
   * Soft-delete the spine rows for confirmed orphans. Explicit, never automatic —
   * see the class note. Returns what it removed so the caller can log it.
   */
  async repair(organizationId: string, courseModuleIds: string[]): Promise<{ removed: number }> {
    if (courseModuleIds.length === 0) return { removed: 0 };
    // Re-scan rather than trusting the caller's list: the ids may be stale, and
    // soft-deleting a HEALTHY module would silently remove a teacher's work.
    const orphans = await this.scan(organizationId);
    const confirmed = new Set(orphans.map((o) => o.courseModuleId));
    const target = courseModuleIds.filter((id) => confirmed.has(id));
    if (target.length === 0) return { removed: 0 };

    const result = await this.prisma.raw.courseModule.updateMany({
      where: { id: { in: target }, organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    // Drop them from their section's denormalised sequence too, or the course
    // page keeps a gap where the activity used to be.
    const sections = await this.prisma.raw.courseSection.findMany({
      where: { organizationId, sequence: { hasSome: target } },
      select: { id: true, sequence: true },
    });
    for (const sec of sections) {
      await this.prisma.raw.courseSection.update({
        where: { id: sec.id },
        data: { sequence: sec.sequence.filter((x: string) => !target.includes(x)) },
      });
    }
    this.logger.warn(`Repaired ${result.count} orphaned course modules in org ${organizationId}`);
    return { removed: result.count };
  }

  /** Nightly sweep across every tenant that has LMS content. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'lms-orphan-check' })
  async nightlySweep(): Promise<void> {
    try {
      const orgs: Array<{ organizationId: string }> = await this.prisma.raw.courseModule.findMany({
        where: { deletedAt: null },
        select: { organizationId: true },
        distinct: ['organizationId'],
      });
      let total = 0;
      for (const { organizationId } of orgs) {
        const orphans = await this.tenant.run({ organizationId }, () => this.scan(organizationId));
        if (orphans.length === 0) continue;
        total += orphans.length;
        this.logger.warn(
          `org ${organizationId}: ${orphans.length} orphaned course module(s) — ` +
            orphans.map((o) => `${o.activityType}:${o.courseModuleId}(${o.reason})`).join(', '),
        );
      }
      if (total === 0) this.logger.log('Orphan check clean across all tenants');
    } catch (err) {
      // A maintenance sweep must never take the API down.
      this.logger.error(`Orphan check failed: ${String(err)}`);
    }
  }

}
