import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../posting/posting.service';
import { TransferDto } from './dto/bank-account.dto';

/**
 * Treasury operations (transfers between cash/bank accounts) post through the
 * PostingService — no separate cash ledger (ADR-009). Customer/supplier
 * receipts & payments live in the Payment module (Phase 3).
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
  ) {}

  async transfer(dto: TransferDto) {
    const entry = await this.posting.post({
      journalCode: 'BANK',
      date: dto.date,
      description: dto.reference ?? 'Funds transfer',
      sourceType: 'treasury_transfer',
      lines: [
        { accountId: dto.toAccountId, debit: dto.amount },
        { accountId: dto.fromAccountId, credit: dto.amount },
      ],
    });
    this.events.publish('bank.transfer', {
      organizationId: this.tenant.organizationId,
      journalEntryId: entry.id,
      amount: String(dto.amount),
    });
    return entry;
  }
}
