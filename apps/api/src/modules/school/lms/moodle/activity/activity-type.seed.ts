import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../kernel/prisma/prisma.service';
import { ActivityRegistry } from './activity-registry.service';

/**
 * Reconciles the LmsActivityType catalog with the live plugin registry. Every
 * registered plugin gets a catalog row; the flags on the row are read by the spine
 * so it never special-cases a plugin. Runs once at boot.
 */
@Injectable()
export class ActivityTypeSeeder {
  private readonly logger = new Logger('ActivityTypeSeeder');
  private done = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ActivityRegistry,
  ) {}

  /** Idempotent upsert of one catalog row per registered plugin. Org-agnostic (global catalog). */
  async sync(): Promise<void> {
    if (this.done) return;
    let order = 0;
    for (const plugin of this.registry.all()) {
      const f = plugin.features;
      await this.prisma.client.lmsActivityType.upsert({
        where: { name: plugin.type },
        create: {
          name: plugin.type,
          label: f.label,
          icon: f.icon,
          gradable: f.gradable,
          supportsGroups: f.supportsGroups,
          supportsCompletionAuto: f.supportsCompletionAuto,
          hasSubmissions: f.hasSubmissions,
          sortOrder: order++,
        },
        update: {
          label: f.label,
          icon: f.icon,
          gradable: f.gradable,
          supportsGroups: f.supportsGroups,
          supportsCompletionAuto: f.supportsCompletionAuto,
          hasSubmissions: f.hasSubmissions,
        },
      });
    }
    this.done = true;
    this.logger.log(`Synced ${this.registry.types().length} activity types: ${this.registry.types().join(', ')}`);
  }
}
