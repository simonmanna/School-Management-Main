import { Injectable } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { BomService } from './bom.service';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Demand forecast from sales history — the make-side of "what should we bake
 * tomorrow". For each finished good with an active BOM it averages the last few
 * weeks of sales (direct product sales + sales via menu items that use it) by
 * weekday and suggests a production quantity for the target day.
 */
@Injectable()
export class ForecastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly boms: BomService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /**
   * @param weeks how many past weeks to average (default 4)
   * @param targetDate the day to forecast for (default tomorrow)
   */
  async forecast(params: { weeks?: number; targetDate?: string } = {}) {
    const weeks = params.weeks && params.weeks > 0 ? params.weeks : 4;
    const since = new Date(Date.now() - weeks * 7 * 86_400_000);
    const target = params.targetDate ? new Date(params.targetDate) : new Date(Date.now() + 86_400_000);
    const targetDow = target.getDay();

    const products = await this.prisma.client.product.findMany({
      where: { manufacturingRole: 'finished', isActive: true },
      select: { id: true, name: true, code: true },
    });

    const out = [];
    for (const p of products) {
      const bom = await this.boms.findActive(p.id, '');
      if (!bom) continue;

      // Menu items that sell this finished good.
      const menuLinks = await this.prisma.client.menuProduct.findMany({
        where: { productId: p.id },
        select: { menuItemId: true },
      });
      const menuItemIds = menuLinks.map((m) => m.menuItemId);

      const items = await this.prisma.client.invoiceItem.findMany({
        where: {
          OR: [{ productId: p.id }, ...(menuItemIds.length ? [{ menuItemId: { in: menuItemIds } }] : [])],
          invoice: { issueDate: { gte: since }, status: { notIn: ['cancelled', 'draft'] as any } },
        },
        select: { quantity: true, invoice: { select: { issueDate: true } } },
      });
      if (items.length === 0) continue;

      const byDow = new Array(7).fill(null).map(() => ZERO);
      for (const it of items) {
        const dow = (it.invoice?.issueDate ?? new Date()).getDay();
        byDow[dow] = byDow[dow].plus(dec(it.quantity));
      }
      const avgByDow = byDow.map((sum) => Number(sum.div(weeks).toFixed(2)));
      out.push({
        productId: p.id,
        name: p.name,
        code: p.code,
        bomId: bom.id,
        averageByWeekday: Object.fromEntries(WEEKDAYS.map((d, i) => [d, avgByDow[i]])),
        suggestedQty: Math.ceil(avgByDow[targetDow]),
        targetWeekday: WEEKDAYS[targetDow],
      });
    }
    return { weeks, targetWeekday: WEEKDAYS[targetDow], suggestions: out.filter((s) => s.suggestedQty > 0) };
  }
}
