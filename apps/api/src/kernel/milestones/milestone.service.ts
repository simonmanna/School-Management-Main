import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { MilestoneRegistry } from './milestone.registry';
import type { ProjectedMilestone } from './milestone.types';

/**
 * Projects an entity's recorded facts (`DomainEventLog`) into the milestone list
 * declared for its type. Read-only: it never writes, it derives.
 *
 * One indexed scan of the ledger per entity (`[organizationId, entityType,
 * entityId]`), then an in-memory fold — the fact volume per entity is small
 * (a handful of lifecycle + fulfillment rows), so this stays cheap.
 */
@Injectable()
export class MilestoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly registry: MilestoneRegistry,
  ) {}

  async forEntity(entityType: string, entityId: string): Promise<ProjectedMilestone[]> {
    const defs = this.registry.forEntityType(entityType);
    if (defs.length === 0) return [];

    const facts = await this.prisma.client.domainEventLog.findMany({
      where: { organizationId: this.tenant.organizationId, entityType, entityId },
      orderBy: { occurredAt: 'asc' },
      select: { eventName: true, occurredAt: true, actorId: true, payload: true },
    });

    return defs.map((def) => {
      const matches = facts.filter(
        (f) =>
          f.eventName === def.fromEvent &&
          (!def.match || def.match((f.payload as Record<string, unknown>) ?? {})),
      );
      if (matches.length === 0) {
        return {
          key: def.key,
          label: def.label,
          sequence: def.sequence,
          reached: false,
          occurredAt: null,
          actorId: null,
          count: 0,
        };
      }
      // `first` (default) is what makes prep timing recall-proof: the earliest
      // fact survives even after the denormalized column has been nulled.
      const chosen = def.occurrence === 'last' ? matches[matches.length - 1] : matches[0];
      return {
        key: def.key,
        label: def.label,
        sequence: def.sequence,
        reached: true,
        occurredAt: chosen.occurredAt,
        actorId: chosen.actorId,
        count: matches.length,
      };
    });
  }
}
