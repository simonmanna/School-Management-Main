import { Body, Controller, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { BankReconciliationService } from './bank-reconciliation.service';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class StatementLineDto {
  @IsDateString() postedAt!: string;
  @IsOptional() @IsString() externalRef?: string;
  @IsString() description!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() currencyCode?: string;
}

class ImportStatementDto {
  @IsString() bankAccountId!: string;
  @IsString() currencyCode!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[];
}

class MatchDto {
  @IsOptional() @IsNumber() dateToleranceDays?: number;
  @IsOptional() @IsString() notes?: string;
}

@Controller('bank-reconciliation')
@UseInterceptors(IdempotencyInterceptor)
export class BankReconciliationController {
  constructor(private readonly svc: BankReconciliationService) {}

  @Post('import')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.bankAccount.update)
  import(@Body() dto: ImportStatementDto) {
    return this.svc.importStatement(
      dto.bankAccountId,
      dto.lines.map((l) => ({ ...l, currencyCode: l.currencyCode ?? dto.currencyCode })),
      dto.currencyCode,
    );
  }

  @Post('match')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.bankAccount.update)
  match(@Query('bankAccountId') bankAccountId: string, @Body() dto: MatchDto) {
    return this.svc.match(bankAccountId, { dateToleranceDays: dto.dateToleranceDays, notes: dto.notes });
  }

  @Post('unmatch/:lineId')
  @HttpCode(204)
  @Idempotent()
  @RequirePermissions(PERMISSIONS.bankAccount.update)
  unmatch(@Param('lineId') lineId: string) {
    return this.svc.unmatch(lineId);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.bankAccount.read)
  status(@Query('bankAccountId') bankAccountId: string) {
    return this.svc.status(bankAccountId);
  }
}