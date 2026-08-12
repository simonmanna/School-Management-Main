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
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CashFlowService } from './cash-flow.service';

class CreateCashAccountDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsIn(['cash', 'bank', 'mobile_money', 'petty_cash']) accountType!: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateCashAccountDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() currencyId?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CashFlowDto {
  @IsString() @IsNotEmpty() accountId!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() description?: string;
}

class TransactionsQueryDto {
  @IsOptional() @Type(() => Number) page: number = 1;
  @IsOptional() @Type(() => Number) pageSize: number = 25;
}

@Controller('accounts/cash-flow')
export class CashFlowController {
  constructor(private readonly cashFlow: CashFlowService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.account.read)
  listAccounts() {
    return this.cashFlow.getCashAccounts();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.account.create)
  create(@Body() dto: CreateCashAccountDto) {
    return this.cashFlow.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.account.update)
  update(@Param('id') id: string, @Body() dto: UpdateCashAccountDto) {
    return this.cashFlow.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.account.delete)
  remove(@Param('id') id: string) {
    return this.cashFlow.remove(id);
  }

  @Get(':id/transactions')
  @RequirePermissions(PERMISSIONS.account.read)
  transactions(@Param('id') id: string, @Query() query: TransactionsQueryDto) {
    return this.cashFlow.getTransactions(id, query.page, query.pageSize);
  }

  @Post('deposit')
  @RequirePermissions(PERMISSIONS.treasury.transfer)
  deposit(@Body() dto: CashFlowDto) {
    return this.cashFlow.deposit(dto.accountId, dto.amount, dto.description);
  }

  @Post('withdraw')
  @RequirePermissions(PERMISSIONS.treasury.transfer)
  withdraw(@Body() dto: CashFlowDto) {
    return this.cashFlow.withdraw(dto.accountId, dto.amount, dto.description);
  }
}
