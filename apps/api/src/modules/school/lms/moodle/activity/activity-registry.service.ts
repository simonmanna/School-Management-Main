import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ActivityPlugin } from '../plugin.types';

/**
 * The activity-plugin registry (ADR-014 §4, following ADR-005's manifest model).
 * Plugins self-register on module init; the spine only ever talks to plugins through
 * this registry, so it never switches on `activityType`.
 */
@Injectable()
export class ActivityRegistry {
  private readonly logger = new Logger('ActivityRegistry');
  private readonly plugins = new Map<string, ActivityPlugin>();

  register(plugin: ActivityPlugin): void {
    if (this.plugins.has(plugin.type)) {
      throw new Error(`Duplicate activity plugin for type '${plugin.type}'`);
    }
    this.plugins.set(plugin.type, plugin);
    this.logger.log(`Registered activity plugin: ${plugin.type}`);
  }

  has(type: string): boolean {
    return this.plugins.has(type);
  }

  get(type: string): ActivityPlugin {
    const p = this.plugins.get(type);
    if (!p) throw new NotFoundException(`No activity plugin registered for type '${type}'`);
    return p;
  }

  all(): ActivityPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Names of every registered plugin — used to seed LmsActivityType + validate at boot. */
  types(): string[] {
    return Array.from(this.plugins.keys());
  }
}
