import { Injectable } from '@nestjs/common';
import type { CashRegister } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class CashRegisterService extends BaseCrudService<CashRegister> {
  protected readonly entityName = 'CashRegister';
  protected readonly searchFields = ['code', 'name'];
  protected readonly defaultInclude = { defaultAccount: true, location: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.cashRegister as unknown as CrudDelegate);
  }
}