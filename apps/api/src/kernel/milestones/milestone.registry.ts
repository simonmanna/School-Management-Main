import { Injectable, Logger } from '@nestjs/common';
import type { MilestoneDefinition } from './milestone.types';

/**
 * In-memory registry of milestone definitions, mirroring `WorkflowRegistry`.
 * Modules register their milestones at startup; `MilestoneService` consults this
 * to project an entity's recorded facts into a business-friendly list.
 *
 * Keyed by `entityType`, holding an ordered list, so a vertical can contribute
 * milestones for `order` without knowing what other modules registered.
 */
@Injectable()
export class MilestoneRegistry {
  private readonly logger = new Logger('MilestoneRegistry');
  private readonly byEntityType = new Map<string, MilestoneDefinition[]>();

  register(def: MilestoneDefinition): void {
    const list = this.byEntityType.get(def.entityType) ?? [];
    if (list.some((d) => d.key === def.key)) {
      throw new Error(`Milestone '${def.key}' is already registered for '${def.entityType}'`);
    }
    list.push(def);
    list.sort((a, b) => a.sequence - b.sequence);
    this.byEntityType.set(def.entityType, list);
    this.logger.log(`Registered milestone '${def.key}' for '${def.entityType}' (from ${def.fromEvent})`);
  }

  /** Register many at once. */
  registerAll(defs: MilestoneDefinition[]): void {
    for (const d of defs) this.register(d);
  }

  /** Definitions for an entity type, in presentation order. */
  forEntityType(entityType: string): MilestoneDefinition[] {
    return this.byEntityType.get(entityType) ?? [];
  }
}
