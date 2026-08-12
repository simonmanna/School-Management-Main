import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';

@Injectable()
export class AssetDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(orgId: string): Promise<any> {
    const where = { organizationId: orgId, deletedAt: null };
    const [totalAssets, activeAssets, maintenanceAssets, disposedAssets, valueAgg, byCategory] =
      await Promise.all([
        this.prisma.client.asset.count({ where }),
        this.prisma.client.asset.count({ where: { ...where, status: 'active' } }),
        this.prisma.client.asset.count({ where: { ...where, status: 'under_maintenance' } }),
        this.prisma.client.asset.count({ where: { ...where, status: 'disposed' } }),
        this.prisma.client.asset.aggregate({ where, _sum: { currentValue: true, purchaseCost: true } }),
        this.prisma.client.assetCategory.findMany({
          where: { organizationId: orgId },
          include: { _count: { select: { assets: true } } },
        }),
      ]);
    return {
      totalAssets,
      activeAssets,
      maintenanceAssets,
      disposedAssets,
      totalValue: valueAgg._sum.currentValue ?? 0,
      totalPurchaseCost: valueAgg._sum.purchaseCost ?? 0,
      byCategory,
    };
  }

  async getUpcoming(orgId: string): Promise<any> {
    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 86400000);
    const in90Days = new Date(Date.now() + 90 * 86400000);
    const [maintenanceDue, warrantyExpiring, recentAssets, recentDepreciation] = await Promise.all([
      this.prisma.client.assetMaintenance.findMany({
        where: {
          organizationId: orgId,
          nextMaintenanceDate: { lte: in30Days, gte: now },
          status: { not: 'completed' },
        },
        include: { asset: { select: { name: true, assetCode: true } } },
        take: 10,
        orderBy: { nextMaintenanceDate: 'asc' },
      }),
      this.prisma.client.assetWarranty.findMany({
        where: { organizationId: orgId, warrantyEnd: { lte: in90Days, gte: now } },
        include: { asset: { select: { name: true, assetCode: true } } },
        take: 10,
        orderBy: { warrantyEnd: 'asc' },
      }),
      this.prisma.client.asset.findMany({
        where: { organizationId: orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { category: true },
      }),
      this.prisma.client.assetDepreciation.findMany({
        where: { organizationId: orgId, isPosted: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { asset: { select: { name: true, assetCode: true } } },
      }),
    ]);
    return { maintenanceDue, warrantyExpiring, recentAssets, recentDepreciation };
  }

  async getReports(orgId: string, type: string): Promise<any> {
    const where = { organizationId: orgId, deletedAt: null };
    switch (type) {
      case 'by-location': {
        const assets = await this.prisma.client.asset.findMany({ where, select: { location: true, id: true } });
        const grouped: Record<string, number> = {};
        for (const a of assets) {
          const loc = a.location ?? 'Unspecified';
          grouped[loc] = (grouped[loc] ?? 0) + 1;
        }
        return grouped;
      }
      case 'by-department': {
        const assets = await this.prisma.client.asset.findMany({ where, select: { department: true, id: true } });
        const grouped: Record<string, number> = {};
        for (const a of assets) {
          const dept = a.department ?? 'Unspecified';
          grouped[dept] = (grouped[dept] ?? 0) + 1;
        }
        return grouped;
      }
      case 'by-status': {
        const assets = await this.prisma.client.asset.findMany({ where, select: { status: true } });
        const grouped: Record<string, number> = {};
        for (const a of assets) grouped[a.status] = (grouped[a.status] ?? 0) + 1;
        return grouped;
      }
      case 'by-category': {
        const cats = await this.prisma.client.assetCategory.findMany({
          where: { organizationId: orgId },
          include: { _count: { select: { assets: true } } },
        });
        return cats.map((c: any) => ({ name: c.name, count: c._count.assets }));
      }
      case 'age-analysis': {
        const now = new Date();
        const assets = await this.prisma.client.asset.findMany({ where, select: { name: true, purchaseDate: true, usefulLife: true } });
        return assets.map((a: any) => {
          const ageMonths = a.purchaseDate ? (now.getFullYear() - a.purchaseDate.getFullYear()) * 12 + (now.getMonth() - a.purchaseDate.getMonth()) : 0;
          const remainingMonths = Math.max(0, (a.usefulLife ?? 60) - ageMonths);
          return { name: a.name, ageMonths, remainingMonths, totalLife: a.usefulLife ?? 60, purchasedDate: a.purchaseDate };
        });
      }
      default: return {};
    }
  }
}
