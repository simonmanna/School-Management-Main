import { NotFoundException } from '@nestjs/common';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginatedResult,
  type PaginationQuery,
} from '@erp/shared';

/** Minimal structural shape of a Prisma model delegate used by the base service. */
export interface CrudDelegate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args?: any): Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findFirst(args?: any): Promise<any | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  count(args?: any): Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(args: any): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMany(args: any): Promise<{ count: number }>;
}

/**
 * Generic CRUD over a tenant-aware Prisma delegate. The tenancy/soft-delete
 * extension automatically scopes every query and injects organizationId on
 * create, so subclasses only declare the delegate, search fields, and
 * (optionally) a default include/order.
 *
 * Note: update/remove use `updateMany({ where: { id } })` on purpose — the
 * extension injects organizationId there, which keeps single-record writes
 * tenant-safe (a by-id `update` cannot carry the extra organizationId filter).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export abstract class BaseCrudService<T = any, CreateInput = any, UpdateInput = any> {
  protected abstract readonly entityName: string;
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude: Record<string, unknown> | undefined = undefined;
  protected readonly defaultOrderBy: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' };

  protected constructor(protected readonly delegate: CrudDelegate) {}

  async list(query: PaginationQuery): Promise<PaginatedResult<T>> {
    const page = Math.max(1, Number(query.page) || DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE));

    const where: Record<string, unknown> = {};
    if (query.search && this.searchFields.length > 0) {
      where.OR = this.searchFields.map((field) => ({
        [field]: { contains: query.search, mode: 'insensitive' },
      }));
    }

    const orderBy = query.sortBy
      ? { [query.sortBy]: query.sortOrder ?? 'asc' }
      : this.defaultOrderBy;

    const [data, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: this.defaultInclude,
      }),
      this.delegate.count({ where }),
    ]);

    return {
      data: data as T[],
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findOne(id: string): Promise<T> {
    const row = await this.delegate.findFirst({ where: { id }, include: this.defaultInclude });
    if (!row) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return row as T;
  }

  async create(data: CreateInput): Promise<T> {
    return (await this.delegate.create({ data, include: this.defaultInclude })) as T;
  }

  async update(id: string, data: UpdateInput): Promise<T> {
    const res = await this.delegate.updateMany({ where: { id }, data });
    if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const res = await this.delegate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
  }
}
