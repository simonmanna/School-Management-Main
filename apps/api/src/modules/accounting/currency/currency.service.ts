import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Phase C: Currency + FX rate service.
 *
 * - Manages the (global) Currency catalog.
 * - Records `CurrencyRate` history (one row per `asOf` per pair). Rates are
 *   denominated in TO per 1 FROM.
 * - `getRate(from, to, asOf)` returns the most recent rate whose asOf ≤
 *   the requested date (per IFRS IAS 21 "rate at transaction date").
 *
 * For an org using only its base currency, no FX calls happen — the rate
 * defaults to 1.
 */
@Injectable()
export class CurrencyService {
  private readonly logger = new Logger('CurrencyService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Idempotent currency upsert. */
  async upsertCurrency(code: string, symbol: string, name: string, decimalPlaces = 2): Promise<void> {
    await this.prisma.raw.currency.upsert({
      where: { code },
      update: { symbol, name, decimalPlaces, isActive: true },
      create: { code, symbol, name, decimalPlaces, isActive: true },
    });
  }

  /** Idempotent rate upsert. Replaces an existing rate for the same (from, to, asOf). */
  async upsertRate(
    fromCode: string,
    toCode: string,
    asOf: Date,
    rate: string | number,
    source = 'manual',
  ): Promise<void> {
    if (fromCode === toCode) throw new BadRequestException('fromCode and toCode must differ');
    await this.prisma.raw.currencyRate.upsert({
      where: { fromCode_toCode_asOf: { fromCode, toCode, asOf } },
      update: { rate: new Prisma.Decimal(rate), source },
      create: { fromCode, toCode, asOf, rate: new Prisma.Decimal(rate), source },
    });
  }

  /**
   * Returns the FX rate (TO per 1 FROM) valid at `asOf`. If both currencies
   * are the same, returns 1. If the from→to direction has no rate, tries the
   * inverse to→from with a reciprocal. If neither exists, throws.
   */
  async getRate(fromCode: string, toCode: string, asOf: Date): Promise<Prisma.Decimal> {
    if (fromCode === toCode) return new Prisma.Decimal(1);

    const direct = await this.lookupRate(fromCode, toCode, asOf);
    if (direct) return direct;

    const inverse = await this.lookupRate(toCode, fromCode, asOf);
    if (inverse && !inverse.isZero()) {
      return new Prisma.Decimal(1).dividedBy(inverse);
    }
    throw new NotFoundException(
      `No FX rate for ${fromCode}→${toCode} at or before ${asOf.toISOString().slice(0, 10)}`,
    );
  }

  /** Convert `amount` of `fromCode` to `toCode` at `asOf`. */
  async convert(amount: Prisma.Decimal | string | number, fromCode: string, toCode: string, asOf: Date): Promise<Prisma.Decimal> {
    const rate = await this.getRate(fromCode, toCode, asOf);
    return dec(amount).times(rate);
  }

  /** List rates for a pair (most recent first). Useful for UIs and reconciliation. */
  async listRates(fromCode: string, toCode: string, limit = 30): Promise<Array<{ asOf: Date; rate: Prisma.Decimal; source: string }>> {
    const rows = await this.prisma.raw.currencyRate.findMany({
      where: { fromCode, toCode },
      orderBy: { asOf: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => ({ asOf: r.asOf, rate: r.rate, source: r.source }));
  }

  private async lookupRate(fromCode: string, toCode: string, asOf: Date): Promise<Prisma.Decimal | null> {
    const row = await this.prisma.raw.currencyRate.findFirst({
      where: { fromCode, toCode, asOf: { lte: asOf } },
      orderBy: { asOf: 'desc' },
    });
    return row ? (row.rate as Prisma.Decimal) : null;
  }
}