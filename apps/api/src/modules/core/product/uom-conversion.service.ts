import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { dec } from '../../../kernel/common/money';

type UomLike = {
  id: string;
  code: string;
  categoryId: string | null;
  category: string;
  factor: Prisma.Decimal;
  roundingPrecision: Prisma.Decimal;
};

/**
 * Central unit conversion. Units convert only WITHIN a category, each expressed
 * against the category reference via `factor` (= base units per 1 of this unit):
 *
 *   baseQty          = qty * from.factor
 *   qty_in_targetUom = baseQty / to.factor
 *   convert(from→to) = qty * from.factor / to.factor
 *
 * Cross-category conversion (e.g. Litre → Kilogram for a specific product's
 * density) requires a per-product `ProductUomConversion` bridge, else it throws.
 * Results are rounded to the target unit's `roundingPrecision` step.
 */
@Injectable()
export class UomConversionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pure factor conversion within a category. Exposed for unit tests. */
  static convertByFactor(
    qty: Prisma.Decimal.Value,
    fromFactor: Prisma.Decimal.Value,
    toFactor: Prisma.Decimal.Value,
  ): Prisma.Decimal {
    const tf = dec(toFactor);
    if (tf.lte(0)) throw new BadRequestException('Target unit factor must be positive');
    return dec(qty).times(dec(fromFactor)).dividedBy(tf);
  }

  /** Round a quantity to the nearest multiple of `step` (0/negative → no rounding). */
  static roundToStep(qty: Prisma.Decimal.Value, step: Prisma.Decimal.Value): Prisma.Decimal {
    const s = dec(step);
    if (s.lte(0)) return dec(qty);
    return dec(qty).dividedBy(s).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).times(s);
  }

  private async getUom(id: string): Promise<UomLike> {
    const u = await this.prisma.client.unitOfMeasure.findFirst({ where: { id } });
    if (!u) throw new BadRequestException(`Unit of measure ${id} not found`);
    return u as unknown as UomLike;
  }

  private sameCategory(a: UomLike, b: UomLike): boolean {
    if (a.categoryId && b.categoryId) return a.categoryId === b.categoryId;
    // Pre-backfill fallback: compare the legacy free-text category tag.
    return a.category === b.category;
  }

  /**
   * Convert `qty` from `fromUomId` to `toUomId`. Same-category → factor math;
   * cross-category → a `ProductUomConversion` bridge for `productId` (either
   * direction), else BadRequestException. Rounds to the target unit's precision.
   */
  async convert(
    qty: Prisma.Decimal.Value,
    fromUomId: string,
    toUomId: string,
    opts: { productId?: string; round?: boolean } = {},
  ): Promise<Prisma.Decimal> {
    if (fromUomId === toUomId) return dec(qty);
    const [from, to] = await Promise.all([this.getUom(fromUomId), this.getUom(toUomId)]);

    let result: Prisma.Decimal;
    if (this.sameCategory(from, to)) {
      result = UomConversionService.convertByFactor(qty, from.factor, to.factor);
    } else {
      const bridge = opts.productId
        ? await this.prisma.client.productUomConversion.findFirst({
            where: { productId: opts.productId, fromUomId, toUomId },
          })
        : null;
      if (bridge) {
        result = dec(qty).times(bridge.factor);
      } else {
        const inverse = opts.productId
          ? await this.prisma.client.productUomConversion.findFirst({
              where: { productId: opts.productId, fromUomId: toUomId, toUomId: fromUomId },
            })
          : null;
        if (inverse) {
          if (dec(inverse.factor).lte(0)) throw new BadRequestException('Invalid product conversion factor');
          result = dec(qty).dividedBy(inverse.factor);
        } else {
          throw new BadRequestException(
            `No conversion from ${from.code} to ${to.code}: different categories — add a product-specific conversion.`,
          );
        }
      }
    }
    return opts.round === false ? result : UomConversionService.roundToStep(result, to.roundingPrecision);
  }

  /** Convert into the product's base (stock) unit. No-op when `fromUomId` is null/base. */
  async toBase(
    qty: Prisma.Decimal.Value,
    fromUomId: string | null | undefined,
    product: { id: string; uomId: string | null },
    opts: { round?: boolean } = {},
  ): Promise<Prisma.Decimal> {
    if (!fromUomId || !product.uomId || fromUomId === product.uomId) return dec(qty);
    return this.convert(qty, fromUomId, product.uomId, { productId: product.id, round: opts.round });
  }

  /** Convert from the product's base (stock) unit into `toUomId`. */
  async fromBase(
    qty: Prisma.Decimal.Value,
    toUomId: string | null | undefined,
    product: { id: string; uomId: string | null },
    opts: { round?: boolean } = {},
  ): Promise<Prisma.Decimal> {
    if (!toUomId || !product.uomId || toUomId === product.uomId) return dec(qty);
    return this.convert(qty, product.uomId, toUomId, { productId: product.id, round: opts.round });
  }
}
