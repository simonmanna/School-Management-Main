import { Injectable, Logger } from '@nestjs/common';
import type { WorkflowDefinition } from '@erp/shared';

/**
 * In-memory registry of declarative state machines (ADR-007). Each module
 * registers its workflows at startup (built-ins are wired in kernel.ts).
 * WorkflowService consults this to validate transitions.
 */
@Injectable()
export class WorkflowRegistry {
  private readonly logger = new Logger('WorkflowRegistry');
  private readonly defs = new Map<string, WorkflowDefinition>();

  register(definition: WorkflowDefinition): void {
    if (this.defs.has(definition.documentType)) {
      throw new Error(`Workflow for '${definition.documentType}' is already registered`);
    }
    this.defs.set(definition.documentType, definition);
    this.logger.log(`Registered workflow '${definition.documentType}' (initial=${definition.initial}, ${definition.transitions.length} transitions)`);
  }

  get(documentType: string): WorkflowDefinition | undefined {
    return this.defs.get(documentType);
  }

  list(): WorkflowDefinition[] {
    return [...this.defs.values()];
  }
}