/**
 * Unit: DmsTypeResolver — boot cache, cache hit, DB fallback, unknown code.
 * Uses a stubbed raw client (no DB).
 */
import { NotFoundException } from '@nestjs/common';
import { DmsTypeResolver } from './dms-type-resolver.service';

describe('DmsTypeResolver', () => {
  const makePrisma = (rows: Array<{ id: string; code: string }>) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const findUnique = jest.fn().mockImplementation(async ({ where }: { where: { code?: string } }) => {
      return rows.find((r) => r.code === where.code) ?? null;
    });
    return { raw: { documentTypeDef: { findMany, findUnique } } } as any;
  };

  it('refresh() warms the cache from the registry', async () => {
    const resolver = new DmsTypeResolver(makePrisma([
      { id: 'uuid-1', code: 'sales_invoice' },
      { id: 'uuid-2', code: 'pos_receipt' },
    ]));
    await resolver.refresh();
    expect(resolver.cachedIds().size).toBe(2);
  });

  it('resolveIdByCode hits the cache without touching the DB', async () => {
    const prisma = makePrisma([{ id: 'uuid-1', code: 'sales_invoice' }]);
    const resolver = new DmsTypeResolver(prisma);
    await resolver.refresh();
    const id = await resolver.resolveIdByCode('sales_invoice');
    expect(id).toBe('uuid-1');
    expect(prisma.raw.documentTypeDef.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to a query on cache miss (e.g. brand-new type on first boot)', async () => {
    const prisma = makePrisma([{ id: 'uuid-9', code: 'school_report_card' }]);
    const resolver = new DmsTypeResolver(prisma);
    const id = await resolver.resolveIdByCode('school_report_card');
    expect(id).toBe('uuid-9');
    expect(prisma.raw.documentTypeDef.findUnique).toHaveBeenCalledTimes(1);
    // second call is cached
    await resolver.resolveIdByCode('school_report_card');
    expect(prisma.raw.documentTypeDef.findUnique).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException for unknown codes', async () => {
    const resolver = new DmsTypeResolver(makePrisma([]));
    await expect(resolver.resolveIdByCode('no_such_type')).rejects.toBeInstanceOf(NotFoundException);
  });
});