import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

/**
 * Meal Reports — aggregated analytics over a date range. All numbers are derived
 * from existing operational tables (sessions, production, waste, wallet ledger);
 * no new accounting or inventory primitives are introduced.
 */
@Injectable()
export class MealReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const end = to ? new Date(to) : new Date();

    // Attendance: expected vs served across all sessions in range.
    const sessions = await this.prisma.client.mealSession.findMany({
      where: { date: { gte: start, lte: end } },
      select: { expectedCount: true, servedCount: true },
    });
    const expected = sessions.reduce((s, x) => s + (x.expectedCount ?? 0), 0);
    const served = sessions.reduce((s, x) => s + (x.servedCount ?? 0), 0);

    // Production plans + items in range.
    const plans = await this.prisma.client.mealProductionPlan.findMany({
      where: { date: { gte: start, lte: end } },
      include: { items: true },
    });
    let plannedQty = 0, issuedQty = 0, consumedQty = 0, wastedQty = 0, foodCost = 0;
    for (const p of plans) {
      for (const it of p.items) {
        plannedQty += Number(it.plannedQuantity ?? 0);
        issuedQty += Number(it.issuedQuantity ?? 0);
        consumedQty += Number(it.consumedQuantity ?? 0);
        wastedQty += Number(it.wastedQuantity ?? 0);
        foodCost += Number(it.unitCost ?? 0) * Number(it.consumedQuantity ?? 0);
      }
    }

    // Waste cost in range (explicit waste records).
    const waste = await this.prisma.client.mealWaste.findMany({
      where: { recordedAt: { gte: start, lte: end } },
      select: { cost: true, quantity: true },
    });
    const wasteCost = waste.reduce((s, w) => s + Number(w.cost ?? 0), 0);
    const wasteQty = waste.reduce((s, w) => s + Number(w.quantity ?? 0), 0);

    // Wallet ledger in range.
    const txns = await this.prisma.client.mealAccountTransaction.findMany({
      where: { createdAt: { gte: start, lte: end } },
      select: { type: true, amount: true },
    });
    let topUps = 0, purchases = 0;
    for (const t of txns) {
      const amt = Number(t.amount ?? 0);
      if (t.type === 'top_up') topUps += amt;
      else if (t.type === 'purchase') purchases += amt;
    }

    const attendanceRate = expected > 0 ? (served / expected) * 100 : 0;
    const wastePct = foodCost > 0 ? (wasteCost / foodCost) * 100 : 0;

    return {
      from: start,
      to: end,
      attendance: { expected, served, rate: Math.round(attendanceRate * 100) / 100 },
      production: { plans: plans.length, plannedQty, issuedQty, consumedQty, wastedQty, foodCost: Math.round(foodCost * 100) / 100 },
      waste: { records: waste.length, wasteQty: Math.round(wasteQty * 100) / 100, wasteCost: Math.round(wasteCost * 100) / 100, wastePct: Math.round(wastePct * 100) / 100 },
      wallet: { topUps: Math.round(topUps * 100) / 100, purchases: Math.round(purchases * 100) / 100 },
    };
  }
}
