import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PaginationDto } from '../../../kernel/common/pagination.dto';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { BankAccountService } from './bank-account.service';
import { TreasuryService } from './treasury.service';
import {
  CreateBankAccountDto,
  TransferDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';

@Controller()
export class TreasuryController {
  constructor(
    private readonly bankAccounts: BankAccountService,
    private readonly treasury: TreasuryService,
  ) {}

  @Get('bank-accounts')
  @RequirePermissions(PERMISSIONS.bankAccount.read)
  listBankAccounts(@Query() query: PaginationDto) {
    return this.bankAccounts.list({ ...query, pageSize: query.pageSize ?? 100 });
  }

  @Post('bank-accounts')
  @RequirePermissions(PERMISSIONS.bankAccount.create)
  createBankAccount(@Body() dto: CreateBankAccountDto) {
    return this.bankAccounts.create(dto);
  }

  @Patch('bank-accounts/:id')
  @RequirePermissions(PERMISSIONS.bankAccount.update)
  updateBankAccount(@Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.bankAccounts.update(id, dto);
  }

  @Delete('bank-accounts/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.bankAccount.delete)
  removeBankAccount(@Param('id') id: string) {
    return this.bankAccounts.remove(id);
  }

  @Post('treasury/transfer')
  @RequirePermissions(PERMISSIONS.treasury.transfer)
  transfer(@Body() dto: TransferDto) {
    return this.treasury.transfer(dto);
  }
}
