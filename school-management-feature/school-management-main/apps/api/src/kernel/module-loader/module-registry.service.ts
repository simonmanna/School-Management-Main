import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { ERPModule } from './erp-module.interface';

/**
 * Collects module manifests and validates the dependency graph at boot
 * (ADR-005): missing dependencies and cycles fail startup; the resolved load
 * order is logged.
 */
@Injectable()
export class ModuleRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger('ModuleRegistry');
  private readonly modules = new Map<string, ERPModule>();

  register(manifest: ERPModule): void {
    if (this.modules.has(manifest.name)) {
      throw new Error(`Duplicate module registration: '${manifest.name}'`);
    }
    this.modules.set(manifest.name, manifest);
  }

  list(): ERPModule[] {
    return [...this.modules.values()];
  }

  has(name: string): boolean {
    return this.modules.has(name);
  }

  onApplicationBootstrap(): void {
    this.validate();
  }

  private validate(): void {
    for (const mod of this.modules.values()) {
      for (const dep of mod.dependencies) {
        if (!this.modules.has(dep)) {
          throw new Error(`Module '${mod.name}' depends on missing module '${dep}'`);
        }
      }
    }
    const order = this.topologicalSort();
    this.logger.log(`Loaded ${this.modules.size} module(s): ${order.join(' -> ')}`);
  }

  private topologicalSort(): string[] {
    const state = new Map<string, 'visiting' | 'done'>();
    const order: string[] = [];

    const visit = (name: string, stack: string[]): void => {
      const current = state.get(name);
      if (current === 'done') return;
      if (current === 'visiting') {
        throw new Error(`Cyclic module dependency detected: ${[...stack, name].join(' -> ')}`);
      }
      state.set(name, 'visiting');
      for (const dep of this.modules.get(name)!.dependencies) {
        visit(dep, [...stack, name]);
      }
      state.set(name, 'done');
      order.push(name);
    };

    for (const name of this.modules.keys()) {
      visit(name, []);
    }
    return order;
  }
}
