import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { CurrencyService } from './currency.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

class UpsertCurrencyDto {
  @IsString() code!: string;
  @IsString() symbol!: string;
  @IsString() name!: string;
  @IsOptional() @IsNumber() @Min(0) decimalPlaces?: number;
}

class UpsertRateDto {
  @IsString() fromCode!: string;
  @IsString() toCode!: string;
  @IsDateString() asOf!: string;
  @IsNumber() @Min(0) rate!: number;
  @IsOptional() @IsString() source?: string;
}

@Controller('currencies')
export class CurrencyController {
  constructor(
    private readonly svc: CurrencyService,
    private readonly prisma: PrismaService,
  ) {}

  /** List the global currency catalog. */
  @Get()
  @RequirePermissions(PERMISSIONS.currency.read)
  async list() {
    return this.prisma.raw.currency.findMany({ orderBy: { code: 'asc' } });
  }

  /** List FX rates for a pair (most recent first). */
  @Get('rates')
  @RequirePermissions(PERMISSIONS.currency.read)
  rates(@Query('fromCode') fromCode: string, @Query('toCode') toCode: string, @Query('limit') limit?: string) {
    return this.svc.listRates(fromCode, toCode, limit ? Number(limit) : 30);
  }

  /** Get the FX rate valid at a given asOf date. */
  @Get('rate')
  @RequirePermissions(PERMISSIONS.currency.read)
  async rateAt(
    @Query('fromCode') fromCode: string,
    @Query('toCode') toCode: string,
    @Query('asOf') asOf: string,
  ) {
    const rate = await this.svc.getRate(fromCode, toCode, new Date(asOf));
    return { fromCode, toCode, asOf, rate: rate.toString() };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.currency.create)
  createCurrency(@Body() dto: UpsertCurrencyDto) {
    return this.svc.upsertCurrency(dto.code, dto.symbol, dto.name, dto.decimalPlaces ?? 2);
  }

  @Post('rates')
  @RequirePermissions(PERMISSIONS.currency.update)
  createRate(@Body() dto: UpsertRateDto) {
    return this.svc.upsertRate(dto.fromCode, dto.toCode, new Date(dto.asOf), dto.rate, dto.source ?? 'manual');
  }
}