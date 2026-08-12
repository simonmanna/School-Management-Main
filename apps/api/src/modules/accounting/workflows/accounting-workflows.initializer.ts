import { Injectable, OnModuleInit } from '@nestjs/common';
import type { WorkflowDefinition } from '@erp/shared';
import { WorkflowRegistry } from '../../../kernel/workflow/workflow.registry';
import { PostingService } from '../posting/posting.service';

/**
 * Registers the journal_entry workflow (ADR-007). Owned by the accounting
 * module because reversing a journal entry is the GL engine's job.
 */
@Injectable()
export class AccountingWorkflowsInitializer implements OnModuleInit {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly posting: PostingService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      documentType: 'journal_entry',
      initial: 'draft',
      transitions: [
        {
          from: 'posted', to: 'reversed', action: 'reverse',
          permission: 'journal_entry:reverse',
          sideEffect: async (ctx, tx) => {
            const entry = ctx.entity as any;
            await this.posting.reverse(entry.id, { description: `Reversal of ${entry.entryNumber}` }, tx);
          },
        },
      ],
    });
  }
}