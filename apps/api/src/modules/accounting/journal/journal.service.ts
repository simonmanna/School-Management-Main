import { BadRequestException, Injectable } from '@nestjs/common';
import type { Journal } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';

@Injectable()
export class JournalService extends BaseCrudService<Journal, CreateJournalDto, UpdateJournalDto> {
  protected readonly entityName = 'Journal';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultOrderBy = { code: 'asc' as const };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.journal as unknown as CrudDelegate);
  }

  /**
   * Resolve the JOURNAL a sales document will post to, in priority order:
   *   1. `preferredId` (the invoice's Invoicing Journal when the user picked one)
   *   2. the org "Default Sales Journal" setting (`accounting.defaultSalesJournalId`)
   *   3. the active journal with code `SALES` (legacy default)
   *   4. the first active `sales`-type journal
   * Throws a clear error when the org has no usable sales journal at all.
   * `client` may be a transaction client — entries and the setting read share it.
   */
  async resolveSalesJournal(
    client: any = this.prisma.client,
    preferredId?: string | null,
  ): Promise<Journal> {
    if (preferredId) {
      const preferred = await client.journal.findFirst({
        where: { id: preferredId, isActive: true },
      });
      if (preferred) return preferred;
    }

    // Setting model is excluded from the tenancy extension → scope explicitly.
    const setting = await client.setting.findFirst({
      where: {
        organizationId: this.tenant.organizationId,
        scopeType: 'organization',
        scopeId: '',
        key: 'accounting.defaultSalesJournalId',
      },
    });
    if (setting?.value) {
      const bySetting = await client.journal.findFirst({
        where: { id: String(setting.value), isActive: true },
      });
      if (bySetting) return bySetting;
    }

    const byCode = await client.journal.findFirst({
      where: { code: 'SALES', isActive: true },
    });
    if (byCode) return byCode;

    const firstSales = await client.journal.findFirst({
      where: { journalType: 'sales', isActive: true },
      orderBy: { code: 'asc' },
    });
    if (firstSales) return firstSales;

    throw new BadRequestException(
      'No active sales journal configured. Set the Default Sales Journal in Company Settings or create a sales journal in Journals.',
    );
  }
}
