import { Injectable } from '@nestjs/common';
import type { UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';

@Injectable()
export class UomService extends BaseCrudService<UnitOfMeasure> {
  protected readonly entityName = 'UnitOfMeasure';
  protected readonly searchFields = ['code', 'name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.unitOfMeasure as unknown as CrudDelegate);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(dto: any): Promise<UnitOfMeasure> {
    return super.create(this.syncFactor({ ...dto }) as any);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(id: string, dto: any): Promise<UnitOfMeasure> {
    return super.update(id, this.syncFactor({ ...dto }) as any);
  }

  /** Keep the authoritative `factor` and the legacy `ratio` in lock-step. */
  private syncFactor(data: Record<string, unknown>): Record<string, unknown> {
    if (data.factor === undefined && data.ratio !== undefined) data.factor = data.ratio;
    if (data.ratio === undefined && data.factor !== undefined) data.ratio = data.factor;
    return data;
  }
}