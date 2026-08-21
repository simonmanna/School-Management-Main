import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PaginatedResult,
  type PaginationQuery,
} from '@erp/shared';
import { SOFT_DELETE } from '../../kernel/prisma/tenancy.extension';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteMany(args: any): Promise<{ count: number }>;
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
  /**
   * Prisma accepts an array for multi-key ordering (e.g. sortOrder then code),
   * which the chart of accounts needs to render in statement order.
   */
  protected readonly defaultOrderBy:
    | Record<string, 'asc' | 'desc'>
    | Array<Record<string, 'asc' | 'desc'>> = { createdAt: 'desc' };

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
    try {
      return (await this.delegate.create({ data, include: this.defaultInclude })) as T;
    } catch (err) {
      // A duplicate unique value (e.g. reusing an existing code) must surface as
      // a clean 409, not an unhandled 500. This mirrors the handling in update().
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${this.entityName} with these details already exists`);
      }
      throw err;
    }
  }

  async update(id: string, data: UpdateInput): Promise<T> {
    try {
      const res = await this.delegate.updateMany({ where: { id }, data });
      if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
      return this.findOne(id);
    } catch (err) {
      // A duplicate unique value (e.g. renaming to an existing name) must surface
      // as a clean 409, not an unhandled 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`${this.entityName} update conflicts with an existing record`);
      }
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    // Models registered in the tenancy extension's SOFT_DELETE set carry a
    // `deletedAt` column and must be soft-deleted. Models without it (e.g.
    // TeacherAssignment, Bed, Borrowing, FeeSchedule, …) would 500 on the
    // `deletedAt` write — fall back to a hard delete for those. `entityName`
    // mirrors the Prisma model name for the vast majority of services.
    if (SOFT_DELETE.has(this.entityName)) {
      const res = await this.delegate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
      return;
    }
    const res = await this.delegate.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException(`${this.entityName} ${id} not found`);
  }
}
