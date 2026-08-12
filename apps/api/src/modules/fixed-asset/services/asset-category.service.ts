import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseCrudService } from '../../../kernel/common/base-crud.service';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateAssetCategoryDto } from '../dto/create-asset-category.dto';
import type { UpdateAssetCategoryDto } from '../dto/update-asset-category.dto';

@Injectable()
export class AssetCategoryService extends BaseCrudService<any, CreateAssetCategoryDto, UpdateAssetCategoryDto> {
  protected readonly entityName = 'AssetCategory';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { parent: true, _count: { select: { assets: true } } };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.assetCategory);
  }

  async findAll(): Promise<any[]> {
    return this.prisma.client.assetCategory.findMany({
      where: { parentId: null },
      include: {
        children: { include: { _count: { select: { assets: true } } } },
        _count: { select: { assets: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateAssetCategoryDto): Promise<any> {
    const existing = await this.prisma.client.assetCategory.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`AssetCategory ${id} not found`);
    return this.prisma.client.assetCategory.update({ where: { id }, data: dto as any, include: this.defaultInclude });
  }

  async remove(id: string): Promise<void> {
    const count = await this.prisma.client.asset.count({ where: { categoryId: id, deletedAt: null } });
    if (count > 0) throw new NotFoundException(`Cannot delete category with ${count} assigned assets`);
    const res = await this.prisma.client.assetCategory.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`AssetCategory ${id} not found`);
  }
}
