import { Injectable, Logger } from '@nestjs/common';
import type { LifecycleDefinition } from './lifecycle.types';

/**
 * LifecycleRegistry — modules register their lifecycle definitions at
 * `onModuleInit`, mirroring ModuleRegistry. The registry enforces guarded
 * transitions for every registered definition; an unregistered defKey is
 * rejected so a typo cannot silently bypass the state machine.
 */
@Injectable()
export class LifecycleRegistry {
  private readonly logger = new Logger('LifecycleRegistry');
  private readonly definitions = new Map<string, LifecycleDefinition>();

  register(def: LifecycleDefinition): void {
    if (this.definitions.has(def.key)) {
      this.logger.warn(`Lifecycle definition '${def.key}' already registered — overwriting`);
    }
    this.definitions.set(def.key, def);
    this.logger.log(`Registered lifecycle '${def.key}' (${def.states.length} states)`);
  }

  get(defKey: string): LifecycleDefinition | undefined {
    return this.definitions.get(defKey);
  }

  /**
   * Assert a transition is legal for the definition. Throws when:
   *  - the definition is unknown,
   *  - the from-state is not one of the definition's states,
   *  - the to-state is not one of the definition's states,
   *  - the (from → to, action) pair is not a declared transition.
   */
  assertTransition(defKey: string, from: string | null, to: string, action: string): void {
    const def = this.definitions.get(defKey);
    if (!def) {
      throw new Error(`Unknown lifecycle definition '${defKey}' — register it in a module's onModuleInit`);
    }
    if (from !== null && !def.states.includes(from)) {
      throw new Error(`Lifecycle '${defKey}': unknown from-state '${from}' (valid: ${def.states.join(', ')})`);
    }
    if (!def.states.includes(to)) {
      throw new Error(`Lifecycle '${defKey}': unknown to-state '${to}' (valid: ${def.states.join(', ')})`);
    }
    if (def.terminalStates.includes(from ?? '')) {
      throw new Error(`Lifecycle '${defKey}': state '${from}' is terminal, no further transitions`);
    }
    const legal = def.transitions.some(
      (t) => t.to === to && t.action === action && (t.from === null || t.from === from),
    );
    if (!legal) {
      throw new Error(
        `Illegal lifecycle transition '${defKey}': ${from ?? '(initial)'} --${action}--> ${to}`,
      );
    }
  }
}
