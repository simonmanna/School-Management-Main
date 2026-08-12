import { BadRequestException, Injectable } from '@nestjs/common';
import type { CashRegister } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class CashRegisterService extends BaseCrudService<CashRegister> {
  protected readonly entityName = 'CashRegister';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultInclude = { defaultAccount: true, location: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {
    super(prisma.client.cashRegister as unknown as CrudDelegate);
  }

  async create(data: any): Promise<CashRegister> {
    const orgId = this.tenant.organizationId;
    const result = await this.prisma.client.$transaction(async (tx) => {
      const register = await tx.cashRegister.create({ data, include: this.defaultInclude });

      const drawerCode = `DRW-${register.code}`;
      const existing = await tx.account.findUnique({
        where: { organizationId_code: { organizationId: orgId, code: drawerCode } },
      });
      if (!existing) {
        const cashCategory = await tx.accountCategory.findFirst({ where: { key: 'cash' } });
        if (!cashCategory) {
          throw new BadRequestException(
            "Account category 'cash' is missing for this organization. " +
              'Run the accounting backfill (prisma/backfill-account-category.ts).',
          );
        }
        const drawerAccount = await tx.account.create({
          data: {
            organizationId: orgId,
            code: drawerCode,
            name: `Cash Drawer - ${register.name}`,
            categoryId: cashCategory.id,
            normalBalance: cashCategory.normalBalance,
            isDefault: false,
          },
        });
        await tx.cashRegister.update({
          where: { id: register.id },
          data: { defaultAccountId: drawerAccount.id },
        });
        register.defaultAccountId = drawerAccount.id;
      }
      return register;
    });
    return result;
  }
}
