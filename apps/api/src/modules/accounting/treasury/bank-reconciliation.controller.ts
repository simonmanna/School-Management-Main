import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { Idempotent } from '../../../kernel/idempotency/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../kernel/idempotency/idempotency.interceptor';
import { BankReconciliationService } from './bank-reconciliation.service';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Signed decimal as a string, so money never passes through a float. */
const MONEY_RE = /^-?\d{1,15}(\.\d{1,6})?$/;

class StatementLineDto {
  @IsDateString() postedAt!: string;
  @IsOptional() @IsString() @MaxLength(200) externalRef?: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  /** Money in positive, money out negative. */
  @Matches(MONEY_RE, { message: 'amount must be a signed decimal string' }) amount!: string;
  @IsOptional() @IsString() @MaxLength(3) currencyCode?: string;
}

class ImportStatementDto {
  @IsString() bankAccountId!: string;
  @IsOptional() @IsString() @MaxLength(3) currencyCode?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[];
}

class MatchDto {
  @IsString() bankAccountId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(7) dateToleranceDays?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class ManualMatchDto {
  @IsString() journalLineId!: string;
}

class ReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ExcludeDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

/**
 * Bank reconciliation against the general ledger (wave 18). Reading, importing
 * and reconciling are separate grants, and none of them is `bank_account:update`.
 */
@Controller('bank-reconciliation')
@UseInterceptors(IdempotencyInterceptor)
export class BankReconciliationController {
  constructor(private readonly svc: BankReconciliationService) {}

  @Post('import')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.bankReconciliation.import)
  import(@Body() dto: ImportStatementDto) {
    return this.svc.importStatement(dto.bankAccountId, dto.lines, dto.currencyCode);
  }

  @Post('match')
  @Idempotent()
  @RequirePermissions(PERMISSIONS.bankReconciliation.reconcile)
  match(@Body() dto: MatchDto) {
    return this.svc.match(dto.bankAccountId, { dateToleranceDays: dto.dateToleranceDays, notes: dto.notes });
  }

  @Post('lines/:lineId/match')
  @RequirePermissions(PERMISSIONS.bankReconciliation.reconcile)
  matchLine(@Param('lineId') lineId: string, @Body() dto: ManualMatchDto) {
    return this.svc.matchLine(lineId, dto.journalLineId);
  }

  @Post('lines/:lineId/unmatch')
  @RequirePermissions(PERMISSIONS.bankReconciliation.reconcile)
  unmatch(@Param('lineId') lineId: string, @Body() dto: ReasonDto) {
    return this.svc.unmatch(lineId, dto.reason);
  }

  @Post('lines/:lineId/exclude')
  @RequirePermissions(PERMISSIONS.bankReconciliation.reconcile)
  exclude(@Param('lineId') lineId: string, @Body() dto: ExcludeDto) {
    return this.svc.exclude(lineId, dto.reason);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.bankReconciliation.read)
  status(@Query('bankAccountId') bankAccountId: string) {
    return this.svc.status(bankAccountId);
  }

  @Get('lines')
  @RequirePermissions(PERMISSIONS.bankReconciliation.read)
  lines(
    @Query('bankAccountId') bankAccountId: string,
    @Query('status') status?: string,
  ) {
    return this.svc.statementLines(bankAccountId, status);
  }

  @Get('ledger-lines')
  @RequirePermissions(PERMISSIONS.bankReconciliation.read)
  ledgerLines(@Query('bankAccountId') bankAccountId: string, @Query('asOf') asOf?: string) {
    return this.svc.openLedgerLines(bankAccountId, asOf);
  }

  @Get('report')
  @RequirePermissions(PERMISSIONS.bankReconciliation.read)
  report(
    @Query('bankAccountId') bankAccountId: string,
    @Query('asOf') asOf: string,
    @Query('statementClosingBalance') statementClosingBalance?: string,
  ) {
    return this.svc.report(bankAccountId, asOf || new Date().toISOString().slice(0, 10), statementClosingBalance);
  }
}
