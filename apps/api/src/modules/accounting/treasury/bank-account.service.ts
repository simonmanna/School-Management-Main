import { Injectable } from '@nestjs/common';
import type { BankAccount } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

@Injectable()
export class BankAccountService extends BaseCrudService<
  BankAccount,
  CreateBankAccountDto,
  UpdateBankAccountDto
> {
  protected readonly entityName = 'BankAccount';
  protected readonly searchFields = ['name', 'bankName', 'accountNumber'];
  protected readonly defaultInclude = { account: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.bankAccount as unknown as CrudDelegate);
  }
}
